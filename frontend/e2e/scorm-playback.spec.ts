import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login, signSubmission } from './fixtures';
import { buildScorm12 } from '../../backend/tests/helpers/scormFixture.mjs';

// E2E for SCORM playback (SYS-SCO-05/07/10, traced to SR-177/SR-180): a SCORM training skips the
// quiz and renders the sandboxed iframe on a DIFFERENT origin; the package finds the SCORM API
// through the wrapper and reads the seed synchronously; a passed course + signature creates exactly
// one session, and none before signing.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Trainings this spec created and assigned to the member — cleaned up in afterAll so later specs
// (e.g. sessions-due) still find the seeded dashboard they expect.
const createdTrainings: string[] = [];

/** Create a published, member-assigned SCORM training; returns its id. */
async function makeAssignedScorm(request: APIRequestContext): Promise<string> {
  const adminToken = await tokenFor(request, CREDS.admin);
  const pkgRes = await request.post('/api/trainings/scorm-packages?name=c.zip', {
    headers: { ...auth(adminToken), 'content-type': 'application/octet-stream' },
    data: await buildScorm12({}),
  });
  const packageId = (await pkgRes.json()).packageId;
  const created = await request.post('/api/trainings', { headers: auth(adminToken), data: { name: `E2E SCORM Play ${Date.now()}` } });
  const trainingId = (await created.json()).id;
  await request.put(`/api/trainings/${trainingId}`, { headers: auth(adminToken), data: { scormPackageId: packageId } });
  await request.post(`/api/trainings/${trainingId}/publish-update`, { headers: auth(adminToken), data: { kind: 'silent' } });
  // Assign via the member's seeded role.
  const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
  const lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
  await request.put(`/api/roles/${lab.id}`, {
    headers: auth(adminToken),
    data: { name: lab.name, description: '', trainingIds: [...lab.trainingIds, trainingId] },
  });
  createdTrainings.push(trainingId);
  return trainingId;
}

test.describe('SCORM playback', () => {
  test.afterAll(async ({ request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
    const lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
    if (lab) {
      await request.put(`/api/roles/${lab.id}`, {
        headers: auth(adminToken),
        data: { name: lab.name, description: '', trainingIds: lab.trainingIds.filter((id: string) => !createdTrainings.includes(id)) },
      });
    }
    for (const id of createdTrainings) {
      await request.delete(`/api/trainings/${id}`, { headers: auth(adminToken) });
    }
  });

  test('SYS-SCO-05 / SR-177 / VT-198: the OWNER previews their own course from the session page (raw payload, no scorm summary)', async ({ page, request }) => {
    // Regression guard: the owner/admin payload carries scormPackageId but not the learner-facing
    // `scorm` summary — the session page must treat both as SCORM-backed, or the owner lands in the
    // classic empty flow ("no material", completable by confirmation) instead of the course.
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const pkgRes = await request.post('/api/trainings/scorm-packages?name=c.zip', {
      headers: { ...auth(trainerToken), 'content-type': 'application/octet-stream' },
      data: await buildScorm12({}),
    });
    const packageId = (await pkgRes.json()).packageId;
    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: { name: `E2E Owner Preview ${Date.now()}` },
    });
    const trainingId = (await created.json()).id;
    createdTrainings.push(trainingId);
    await request.put(`/api/trainings/${trainingId}`, { headers: auth(trainerToken), data: { scormPackageId: packageId } });
    await request.post(`/api/trainings/${trainingId}/publish-update`, { headers: auth(trainerToken), data: { kind: 'silent' } });

    await login(page, 'trainer');
    await page.goto(`/session/${trainingId}`);
    // No materials confirmation for a SCORM course — Start goes straight into it.
    await page.getByTestId('session-start').click();
    await expect(page.getByTestId('confirm-materials-dialog')).toHaveCount(0);
    // The course opens — as a preview (an unassigned owner's run is never recordable).
    await expect(page.getByTestId('session-scorm')).toBeVisible();
    await expect(page.getByTestId('scorm-frame')).toBeVisible();
    await expect(page.getByText('Preview — not recorded')).toBeVisible();
  });

  test('SYS-SCO-05 / SR-177 / VT-198: the course runs in a sandboxed cross-origin iframe instead of the quiz', async ({ page, request }) => {
    const trainingId = await makeAssignedScorm(request);
    await login(page, 'member');
    await page.goto(`/session/${trainingId}`);

    // Confirm materials → the SCORM step, not the quiz.
    await page.getByTestId('session-start').click();
    await expect(page.getByTestId('session-scorm')).toBeVisible();
    await expect(page.getByTestId('session-quiz')).toHaveCount(0);

    const frame = page.getByTestId('scorm-frame');
    await expect(frame).toBeVisible();
    // The sandbox attribute must match the shared constant exactly (byte-for-byte with the CSP).
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads');
    await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    const src = await frame.getAttribute('src');
    const frameOrigin = new URL(src!).origin;
    expect(frameOrigin).not.toBe(new URL(page.url()).origin);
    expect(frameOrigin).toBe('https://localhost:4444');
  });

  test('SYS-SCO-07 / SR-177 / VT-209: the package finds the API through the wrapper and reads the seed synchronously', async ({ page, request }) => {
    const trainingId = await makeAssignedScorm(request);
    await login(page, 'member');
    await page.goto(`/session/${trainingId}`);
    await page.getByTestId('session-start').click();

    // Drill into the nested SCO frame (wrapper → SCO) and drive the stub.
    const wrapper = page.frameLocator('[data-testid="scorm-frame"]');
    const sco = wrapper.frameLocator('#sco');
    await sco.getByTestId('sco-init').click();
    const log = sco.getByTestId('sco-log');
    await expect(log).toContainText('LMSInitialize=true');
    // The seed was answered locally and synchronously — the member's name came through.
    await expect(log).toContainText('student_name=');
    await expect(log).toContainText('entry=');
  });

  test('SYS-SCO-10 / SR-180 / VT-202: a passed course + signature creates exactly one session, and none before signing', async ({ page, request }) => {
    const trainingId = await makeAssignedScorm(request);
    const memberToken = await tokenFor(request, CREDS.member);
    await login(page, 'member');
    await page.goto(`/session/${trainingId}`);
    await page.getByTestId('session-start').click();

    const wrapper = page.frameLocator('[data-testid="scorm-frame"]');
    const sco = wrapper.frameLocator('#sco');
    await sco.getByTestId('sco-init').click();
    await sco.getByTestId('sco-set-passed').click();
    await sco.getByTestId('sco-commit').click();
    await sco.getByTestId('sco-finish').click();

    // Before signing: no session recorded.
    const before = await (await request.get('/api/sessions/mine', { headers: auth(memberToken) })).json();
    expect(before.filter((s: { trainingId: string }) => s.trainingId === trainingId)).toHaveLength(0);

    // The Finish button appears once the course reports completion and everything is saved.
    await expect(page.getByTestId('scorm-finish')).toBeVisible();
    await page.getByTestId('scorm-finish').click();
    await signSubmission(page, CREDS.member.password);

    await expect(page.getByTestId('session-result')).toBeVisible();
    await expect(page.getByTestId('scorm-result-score')).toBeVisible();

    const after = await (await request.get('/api/sessions/mine', { headers: auth(memberToken) })).json();
    const sessions = after.filter((s: { trainingId: string }) => s.trainingId === trainingId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].scormAttemptId).toBeTruthy();
  });
});

import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login, publishSilent } from './fixtures';

// E2E for published training updates (SYS-UPD-02/03/04, traced to SR-164/SR-165/SR-167 and
// VT-176/VT-177/VT-178): a content-changing save offers the explicit publish step (a metadata-only
// save stays silent, skipping publishes nothing), the affected learner sees the distinct "Updated"
// badge and version chip on the dashboard card, and the confirm-mode session records the
// acknowledgement without a quiz and returns the training to up-to-date. Endpoint semantics
// (authz, validation, email tolerance, precedence, cancel, prune) are covered API-side in
// backend/tests/training-updates.test.mjs.
//
// The tests in this file run in order and share one arranged training: the trainer publishes
// first, then the learner reacts to it.

const NAME = `E2E Update Training ${Date.now()}`;

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let trainingId: string;
let lab: { id: string; name: string; trainingIds: string[] };

test.describe('Trainings — published updates end to end', () => {
  test.beforeAll(async ({ request }) => {
    // Arrange: a trainer-owned training with a link material and NO questions (so the member can
    // pass it via the empty grading), required by the member's seeded "Lab Technician" role.
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const adminToken = await tokenFor(request, CREDS.admin);
    const memberToken = await tokenFor(request, CREDS.member);

    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: {
        name: NAME,
        materials: [{ variants: [{ locale: 'en', label: 'Guide', url: 'https://example.com/guide-v1' }] }],
        questions: [],
      },
    });
    expect(created.status()).toBe(201);
    trainingId = (await created.json()).id;
    await publishSilent(request, trainingId, trainerToken); // v1 — learners see published content only

    const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
    lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
    await request.put(`/api/roles/${lab.id}`, {
      headers: auth(adminToken),
      data: { name: lab.name, trainingIds: [...lab.trainingIds, trainingId] },
    });

    // The member passes it once (confirmation + empty grading) — so a published update affects them.
    await request.post('/api/sessions/confirm-materials', { headers: auth(memberToken), data: { trainingId } });
    const graded = await request.post('/api/sessions/grade', {
      headers: auth(memberToken),
      data: { trainingId, answers: [], reauth: { password: CREDS.member.password } },
    });
    expect((await graded.json()).passed).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    if (lab) {
      await request.put(`/api/roles/${lab.id}`, {
        headers: auth(adminToken),
        data: { name: lab.name, trainingIds: lab.trainingIds },
      });
    }
    if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(adminToken) });
  });

  test('SYS-UPD-02 / SR-164 / VT-176: a content-changing save offers the publish step, a metadata-only save stays silent, skipping publishes nothing, publishing creates v2', async ({ page, request }) => {
    const trainerToken = await tokenFor(request, CREDS.trainer);
    await login(page, 'trainer');
    await page.goto('/trainings');

    // Metadata-only save: rename → no publish dialog.
    await page.getByText(NAME).click();
    const editor = page.getByRole('dialog');
    await expect(editor).toBeVisible();
    await editor.getByPlaceholder('Training name').first().fill(`${NAME} renamed`);
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('publish-update-dialog')).toHaveCount(0);

    // Content change: edit the material URL → the change is STAGED and the publish dialog is
    // offered; Skip keeps it as a draft — trainees still see the published v1 content (SR-170).
    await page.getByText(`${NAME} renamed`).click();
    await editor.getByRole('button', { name: /Learning material/ }).click();
    await editor.getByPlaceholder('https://…').first().fill('https://example.com/guide-v2');
    await editor.getByRole('button', { name: 'Save' }).click();
    const publishDialog = page.getByTestId('publish-update-dialog');
    await expect(publishDialog).toBeVisible();
    await expect(publishDialog).toContainText('publishing creates version 2');
    await publishDialog.getByTestId('publish-update-skip').click();
    await expect(publishDialog).toHaveCount(0);
    const afterSkip = await (await request.get(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) })).json();
    expect(afterSkip.version ?? 1).toBe(1);
    expect(afterSkip.updates ?? []).toHaveLength(0);
    expect(afterSkip.draft.materials[0].variants[0].url).toBe('https://example.com/guide-v2');
    expect(afterSkip.materials[0].variants[0].url, 'the published content is untouched').toBe('https://example.com/guide-v1');

    // Reopen (the editor shows the draft), refine it once more → publish as a confirm-mode update.
    // SMTP is unconfigured in e2e, so the toast reports the publish succeeded without the email —
    // graceful degradation (SR-166).
    await page.getByText(`${NAME} renamed`).click();
    await editor.getByRole('button', { name: /Learning material/ }).click();
    await expect(editor.getByPlaceholder('https://…').first()).toHaveValue('https://example.com/guide-v2');
    await editor.getByPlaceholder('https://…').first().fill('https://example.com/guide-v3');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(publishDialog).toBeVisible();
    await publishDialog.getByText('Review and confirm the materials').click();
    await publishDialog.getByTestId('publish-update-ok').click();
    await expect(page.getByText(/Version 2 published/)).toBeVisible();
    await expect(publishDialog).toHaveCount(0);

    const afterPublish = await (await request.get(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) })).json();
    expect(afterPublish.version).toBe(2);
    expect(afterPublish.updates).toHaveLength(1);
    expect(afterPublish.updates[0].mode).toBe('confirm');
    expect(afterPublish.materials[0].variants[0].url, 'the draft was promoted').toBe('https://example.com/guide-v3');
    expect(afterPublish.draft).toBeUndefined();
  });

  test('SYS-UPD-03 / SR-165 / VT-177: the learner dashboard shows the distinct Updated badge and the bumped version chip, included by the due filter', async ({ page }) => {
    await login(page, 'member');
    // The "only due" filter is on by default — the 'updated' state counts as due work.
    const card = page.locator('.card', { hasText: `${NAME} renamed` });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Updated · by/);
    await expect(card).toContainText('v2');
  });

  test('SYS-UPD-04 / SR-167 / VT-178: the confirm-mode session records the acknowledgement without a quiz and returns the training to up-to-date', async ({ page, request }) => {
    await login(page, 'member');
    const card = page.locator('.card', { hasText: `${NAME} renamed` });
    await card.getByRole('button', { name: 'Start' }).click();
    await expect(page).toHaveURL(new RegExp(`/session/${trainingId}`));

    // The banner explains the update; the primary action is the confirmation, not a test.
    const banner = page.getByTestId('update-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('version 2');
    const start = page.getByTestId('session-start');
    await expect(start).toContainText('Confirm updated materials');
    await start.click();
    await page.getByTestId('confirm-materials-ok').click();

    // No quiz: the confirmation closes the session with its own success screen.
    await expect(page.getByTestId('update-confirmed')).toBeVisible();
    await expect(page.getByTestId('update-confirmed')).toContainText('Update confirmed');

    // The training left the due list (back to up-to-date), and the API agrees.
    await page.getByRole('button', { name: 'Back to My Trainings' }).click();
    await page.waitForURL('**/dashboard');
    await expect(page.locator('.card', { hasText: `${NAME} renamed` })).toHaveCount(0);

    const memberToken = await tokenFor(request, CREDS.member);
    const mine = await (await request.get('/api/trainings/mine', { headers: auth(memberToken) })).json();
    const entry = mine.find((d: { training: { id: string } }) => d.training.id === trainingId);
    expect(entry.status).toBe('up-to-date');
    expect(entry.pendingUpdate).toBeNull();
  });
});

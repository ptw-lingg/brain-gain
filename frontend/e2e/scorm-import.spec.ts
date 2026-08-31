import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';
import { buildScorm12, buildEvilPackage } from '../../backend/tests/helpers/scormFixture.mjs';

// E2E for the trainer SCORM import UI (SYS-SCO-02/03/04, traced to SR-176): the manifest card
// renders parsed values, a manifest-less zip is refused readably, the quiz editor is disabled while
// a package is attached and restored on removal, and attaching a package trips the draft-change
// detection so the publish dialog is offered (the TrainingsPage.vue:255 regression guard).

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function uploadPackage(request: APIRequestContext, token: string, bytes: Buffer, name = 'course.zip'): Promise<string> {
  const res = await request.post(`/api/trainings/scorm-packages?name=${name}`, {
    headers: { ...auth(token), 'content-type': 'application/octet-stream' },
    data: bytes,
  });
  expect(res.status()).toBe(201);
  return (await res.json()).packageId;
}

test.describe('SCORM import UI', () => {
  test('SYS-SCO-02 / SR-176 / VT-193: the manifest card shows the parsed course, and a bad zip is refused readably', async ({ page, request }) => {
    const trainerToken = await tokenFor(request, CREDS.trainer);
    // A training owned by the seeded trainer so it appears in their editor.
    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: { name: `E2E Pkg Import ${Date.now()}` },
    });
    const trainingId = (await created.json()).id;

    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(/E2E Pkg Import/).first().click();

    // Open the SCORM section and upload a valid 1.2 package through the file input.
    await page.getByRole('button', { name: /^SCORM course/ }).click();
    await page.getByTestId('scorm-upload').click();
    await page.getByTestId('scorm-upload').locator('xpath=..').locator('input[type=file]');
    const validZip = await buildScorm12({});
    await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
      name: 'fire-safety.zip',
      mimeType: 'application/zip',
      buffer: validZip,
    });
    const card = page.getByTestId('scorm-manifest-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('SCORM 1.2');
    await expect(card).toContainText('index.html');

    // A manifest-less zip is refused with a readable reason.
    await page.getByTestId('scorm-upload').click();
    const badZip = await buildEvilPackage('no-manifest');
    await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: badZip,
    });
    await expect(page.getByTestId('scorm-error')).toContainText('not a SCORM package');

    void trainingId;
  });

  test('SYS-SCO-03 / SR-176 / VT-212: the quiz editor is disabled while a package is attached and restored on removal', async ({ page, request }) => {
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const pkgId = await uploadPackage(request, trainerToken, await buildScorm12({}));
    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: { name: `E2E Pkg Quiz ${Date.now()}`, scormPackageId: pkgId },
    });
    const trainingId = (await created.json()).id;

    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(/E2E Pkg Quiz/).first().click();
    await page.getByRole('button', { name: /^Quiz questions/ }).click();
    await expect(page.getByTestId('scorm-quiz-disabled')).toBeVisible();

    // Remove the package → the disabled notice disappears.
    await page.getByRole('button', { name: /^SCORM course/ }).click();
    await page.getByTestId('scorm-remove').click();
    await page.getByTestId('scorm-remove-confirm').click();
    await expect(page.getByTestId('scorm-quiz-disabled')).toHaveCount(0);
    void trainingId;
  });

  test('SYS-SCO-04 / SR-176 / VT-211: attaching a package trips the draft change and offers the publish dialog', async ({ page, request }) => {
    // This is the TrainingsPage.vue:255 regression guard — without scormPackageId in the content
    // comparison, the publish dialog would never appear and learners would keep the old content.
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const pkgId = await uploadPackage(request, trainerToken, await buildScorm12({}));
    const created = await request.post('/api/trainings', {
      headers: auth(trainerToken),
      data: { name: `E2E Pkg Publish ${Date.now()}` },
    });
    const trainingId = (await created.json()).id;
    // Publish an empty first version so the training is not "unpublished" (which would open the
    // dialog for a different reason).
    await request.put(`/api/trainings/${trainingId}`, {
      headers: auth(trainerToken),
      data: { materials: [{ variants: [{ locale: 'en', label: 'Doc', url: 'https://example.com/d' }] }] },
    });
    await request.post(`/api/trainings/${trainingId}/publish-update`, { headers: auth(trainerToken), data: { kind: 'silent' } });

    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(/E2E Pkg Publish/).first().click();
    await page.getByRole('button', { name: /^SCORM course/ }).click();
    await page.getByTestId('scorm-upload').click();
    await page.locator('input[type="file"][accept=".zip"]').setInputFiles({
      name: 'course.zip',
      mimeType: 'application/zip',
      buffer: pkgId ? await buildScorm12({}) : await buildScorm12({}),
    });
    await expect(page.getByTestId('scorm-manifest-card')).toBeVisible();
    await page.getByRole('button', { name: /Save/ }).click();

    // The publish-update dialog appears, and it names the SCORM change.
    await expect(page.getByTestId('publish-scorm-change')).toBeVisible();
  });
});

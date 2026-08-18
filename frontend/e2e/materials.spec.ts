import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for uploaded material files (SYS-TRN-11, traced to SR-041 / VT-041): a trainer attaches a file
// to a training in the editor dialog, the descriptor persists with the training, and the learner sees
// and downloads the file in the session's material step. Byte-level round-trip, auth guards and
// path-traversal defenses are covered API-side in backend/tests/materials.test.mjs.
//
// The tests in this file run in order: the trainer uploads first, then the learner consumes it.

const FILE_NAME = 'e2e-material.txt';
const FILE_TEXT = 'BrainGain e2e material file body';

test.describe('Trainings — material files end to end', () => {
  test('SYS-TRN-11 / SR-041 / VT-041: a trainer uploads a material file in the editor dialog and it persists', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText('Laboratory Safety Basics').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Materials are per-locale now: add a material and upload into its English row. The per-row
    // upload button opens the (hidden, shared) picker — intercepted via the file chooser.
    await dialog.getByRole('button', { name: /Learning material/ }).click();
    await dialog.getByRole('button', { name: 'Add material' }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dialog.getByRole('button', { name: 'Upload file (EN)' }).last().click(),
    ]);
    await chooser.setFiles({ name: FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(FILE_TEXT) });
    // The uploaded file lands on the row (and names the material, since the label was empty).
    await expect(dialog.getByText(FILE_NAME).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    // Uploading a file changed the training's CONTENT, so it is STAGED as a draft and the save
    // offers the explicit publish step (SR-164/SR-170). Skip first — the draft must persist.
    const publish = page.getByTestId('publish-update-dialog');
    await expect(publish).toBeVisible();
    await publish.getByTestId('publish-update-skip').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Persistence: reload and reopen — the editor shows the DRAFT content on reopen, so the
    // uploaded file is still there even though nothing is published yet. The section starts
    // collapsed, and its summary badge reports the materials before it is opened.
    await page.reload();
    await page.getByText('Laboratory Safety Basics').click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByRole('button', { name: /Learning material/ })).toContainText(/\d+ materials/);
    await reopened.getByRole('button', { name: /Learning material/ }).click();
    await expect(reopened.getByText(FILE_NAME).first()).toBeVisible();

    // Publish the draft silently so the next test's learner actually receives the new file.
    await reopened.getByTestId('manage-updates').click();
    const versions = page.getByTestId('publish-update-dialog');
    await expect(versions).toBeVisible();
    await versions.getByTestId('publish-kind-silent').check();
    await versions.getByTestId('publish-update-ok').click();
    await expect(page.getByText(/Version 2 published silently/)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('SYS-TRN-11 / SR-041 / VT-041: the learner sees the attached file in the material step and downloads it', async ({ page }) => {
    await login(page, 'member');
    // The first Start opens Laboratory Safety Basics (the seeded required training edited above).
    await page.getByRole('button', { name: /Start/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Laboratory Safety Basics' })).toBeVisible();
    await expect(page.getByTestId('session-material')).toBeVisible();

    // The file appears alongside the link material, named, with a download affordance.
    const fileCard = page.getByRole('button', { name: new RegExp(FILE_NAME) });
    await expect(fileCard).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), fileCard.click()]);
    expect(download.suggestedFilename()).toBe(FILE_NAME);
  });
});

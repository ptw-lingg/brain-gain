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

    // The picker input is hidden (a styled button triggers it) — setInputFiles targets it directly.
    await page.locator('input[type="file"]').setInputFiles({
      name: FILE_NAME,
      mimeType: 'text/plain',
      buffer: Buffer.from(FILE_TEXT),
    });
    // The file uploads immediately and is listed by name inside the dialog.
    await expect(dialog.getByText(FILE_NAME)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    // Persistence: reload and reopen — the saved training still carries the file.
    await page.reload();
    await page.getByText('Laboratory Safety Basics').click();
    await expect(page.getByRole('dialog').getByText(FILE_NAME)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('SYS-TRN-11 / SR-041 / VT-041: the learner sees the attached file in the material step and downloads it', async ({ page }) => {
    await login(page, 'member');
    // The first Start opens Laboratory Safety Basics (the seeded required training edited above).
    await page.getByRole('button', { name: /Start/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Laboratory Safety Basics' })).toBeVisible();
    await expect(page.getByText('step 1 of 3')).toBeVisible();

    // The file appears alongside the link material, named, with a download affordance.
    const fileCard = page.getByRole('button', { name: new RegExp(FILE_NAME) });
    await expect(fileCard).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), fileCard.click()]);
    expect(download.suggestedFilename()).toBe(FILE_NAME);
  });
});

import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for multi-answer quiz questions in the trainer editor (SYS-TRN-12, traced to SR-146 / VT-146).
// Grading semantics (exact set match) are covered API-side in backend/tests/questions-multi.test.mjs;
// here we prove a trainer can actually tick several correct answers and that the choice round-trips.

test.describe('Quiz questions — several correct answers', () => {
  test('SYS-TRN-12 / SR-146 / VT-146: a trainer marks several answers correct and the choice persists', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');

    const name = `E2E Multi-answer ${Date.now()}`;
    await page.getByRole('button', { name: 'Add Training' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Training name').first().fill(name);

    // Add a question with four options. Adding one opens the Questions section and the new question
    // itself, so authoring needs no extra clicks (SYS-TRN-13).
    await dialog.getByRole('button', { name: /Quiz questions/ }).click();
    await dialog.getByRole('button', { name: 'Add question' }).click();
    await dialog.getByPlaceholder('Question 1').first().fill('Which are examples of design output?');
    await dialog.getByRole('button', { name: 'Add option' }).click();
    await dialog.getByRole('button', { name: 'Add option' }).click();
    const options = ['software libraries', 'drawings', 'electrical boards', 'a wish list'];
    for (const [i, text] of options.entries()) {
      await dialog.getByPlaceholder(`Option ${i + 1}`).first().fill(text);
    }

    // A new question starts as single choice — switch it to multiple choice to tick several answers.
    await dialog.getByRole('radio', { name: 'Multiple choice' }).check();

    // The prompt tells the trainer several answers may be ticked, and the control is a checkbox.
    await expect(dialog.getByText(/Tick every correct answer/)).toBeVisible();
    const keyBoxes = dialog.locator('input[type="checkbox"]');
    await expect(keyBoxes).toHaveCount(4);

    // Option 1 is correct by default; also mark options 2 and 3 → three correct answers.
    await keyBoxes.nth(1).check();
    await keyBoxes.nth(2).check();
    await expect(keyBoxes.nth(0)).toBeChecked();
    await expect(keyBoxes.nth(1)).toBeChecked();
    await expect(keyBoxes.nth(2)).toBeChecked();
    await expect(keyBoxes.nth(3)).not.toBeChecked();

    await dialog.getByRole('button', { name: 'Create' }).click();
    // The created content is staged as a draft — the publish step is offered; keep it a draft here.
    await page.getByTestId('publish-update-skip').click();
    await expect(page.getByText(name)).toBeVisible();

    // Reopen after a reload: the full answer key came back from the server. Questions start collapsed,
    // and the question's own row summarises the key before it is opened.
    await page.reload();
    await page.getByText(name).click();
    const reopened = page.getByRole('dialog');
    await reopened.getByRole('button', { name: /Quiz questions/ }).click();
    const questionRow = reopened.getByRole('button', { name: /Which are examples of design output\?/ });
    await expect(questionRow).toContainText('4 options');
    await expect(questionRow).toContainText('3 correct');
    await questionRow.click();

    const saved = reopened.locator('input[type="checkbox"]');
    await expect(saved.nth(0)).toBeChecked();
    await expect(saved.nth(1)).toBeChecked();
    await expect(saved.nth(2)).toBeChecked();
    await expect(saved.nth(3)).not.toBeChecked();
  });

  test('SYS-TRN-12 / VT-146: the last remaining correct answer cannot be unticked', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByRole('button', { name: 'Add Training' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Training name').first().fill(`E2E One-correct ${Date.now()}`);
    await dialog.getByRole('button', { name: /Quiz questions/ }).click();
    await dialog.getByRole('button', { name: 'Add question' }).click();
    // A new question starts as single choice; this spec pins the multiple-choice key rule.
    await dialog.getByRole('radio', { name: 'Multiple choice' }).check();

    // A fresh question has exactly one correct answer, and that one is locked so the question can
    // never end up with no correct answer at all.
    const keyBoxes = dialog.locator('input[type="checkbox"]');
    await expect(keyBoxes.nth(0)).toBeChecked();
    await expect(keyBoxes.nth(0)).toBeDisabled();

    // Ticking a second answer releases the first — now either may be removed.
    await keyBoxes.nth(1).check();
    await expect(keyBoxes.nth(0)).toBeEnabled();
    await keyBoxes.nth(0).uncheck();
    await expect(keyBoxes.nth(0)).not.toBeChecked();
    await expect(keyBoxes.nth(1)).toBeDisabled();
  });
});

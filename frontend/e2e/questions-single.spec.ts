import { test, expect } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for single-choice quiz questions (SYS-TRN-14 in the trainer editor, SYS-SES-06 in the learner
// quiz; traced to SR-149 / SR-150 / VT-149 / VT-150). Write-path coercion and grading semantics are
// covered API-side in backend/tests/questions-single.test.mjs; here we prove a trainer can actually
// switch a question's type (and is blocked while several answers are correct), and that a learner
// answers a single-choice question with radio buttons where a second pick replaces the first.

test.describe('Quiz questions — single choice', () => {
  test('SYS-TRN-14 / SR-149 / VT-149: a trainer switches an existing question to single choice and the radio key persists', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');

    // Create a multiple-choice question first, so the switch below happens on an EXISTING record.
    const name = `E2E Single-choice switch ${Date.now()}`;
    await page.getByRole('button', { name: 'Add Training' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Training name').fill(name);
    await dialog.getByRole('button', { name: /Quiz questions/ }).click();
    await dialog.getByRole('button', { name: 'Add question' }).click();
    await dialog.getByPlaceholder('Question 1').first().fill('Which SOP covers design outputs?');
    await dialog.getByRole('button', { name: 'Add option' }).click();
    for (const [i, text] of ['SOP-10.00', 'SOP-10.02', 'SOP-10.03'].entries()) {
      await dialog.getByPlaceholder(`Option ${i + 1}`).first().fill(text);
    }
    await dialog.getByRole('radio', { name: 'Multiple choice' }).check();
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(name)).toBeVisible();

    // Reopen the saved training and switch the question to single choice — allowed, because it has
    // exactly one correct answer. The answer key flips from checkboxes to radios.
    await page.reload();
    await page.getByText(name).click();
    const reopened = page.getByRole('dialog');
    await reopened.getByRole('button', { name: /Quiz questions/ }).click();
    const questionRow = reopened.getByRole('button', { name: /Which SOP covers design outputs\?/ });
    await expect(questionRow).toContainText('Multiple choice');
    await questionRow.click();

    const singleSwitch = reopened.getByRole('radio', { name: 'Single choice' });
    await expect(singleSwitch).toBeEnabled();
    await singleSwitch.check();
    await expect(reopened.getByText('Select the correct answer')).toBeVisible();

    // Pick option 2 as the correct answer via the radio key — it replaces option 1, no untick needed.
    const key = reopened.locator('input[name="qkey-0"]');
    await expect(key).toHaveCount(3);
    await key.nth(1).check();
    await expect(key.nth(0)).not.toBeChecked();
    await reopened.getByRole('button', { name: 'Save' }).click();

    // The type and the moved answer key both round-tripped through the server.
    await page.reload();
    await page.getByText(name).click();
    const third = page.getByRole('dialog');
    await third.getByRole('button', { name: /Quiz questions/ }).click();
    const savedRow = third.getByRole('button', { name: /Which SOP covers design outputs\?/ });
    await expect(savedRow).toContainText('Single choice');
    await expect(savedRow).toContainText('1 correct');
    await savedRow.click();
    await expect(third.getByRole('radio', { name: 'Single choice' })).toBeChecked();
    await expect(third.locator('input[name="qkey-0"]').nth(1)).toBeChecked();
  });

  test('SYS-TRN-14 / VT-149: switching to single choice is blocked while several answers are correct', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByRole('button', { name: 'Add Training' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Training name').fill(`E2E Switch blocked ${Date.now()}`);
    await dialog.getByRole('button', { name: /Quiz questions/ }).click();
    await dialog.getByRole('button', { name: 'Add question' }).click();

    // Make it multiple-choice with two correct answers.
    await dialog.getByRole('radio', { name: 'Multiple choice' }).check();
    const keyBoxes = dialog.locator('input[type="checkbox"]');
    await keyBoxes.nth(1).check();

    // Two correct answers → the question cannot present as single choice.
    const singleSwitch = dialog.getByRole('radio', { name: 'Single choice' });
    await expect(singleSwitch).toBeDisabled();

    // Reduce the key back to one correct answer → the switch unlocks.
    await keyBoxes.nth(1).uncheck();
    await expect(singleSwitch).toBeEnabled();
    await singleSwitch.check();
    await expect(dialog.getByText('Select the correct answer')).toBeVisible();
  });

  test('SYS-SES-06 / SR-150 / VT-150: a learner answers a single-choice question with radio buttons — picking another replaces the first', async ({ page, request }) => {
    // Arrange through the API (same origin serves SPA and API): a trainer-owned training with one
    // single-choice question, assigned to the seeded member's "Lab Technician" role.
    const trainerLogin = await request.post('/api/auth/login', { data: CREDS.trainer });
    expect(trainerLogin.ok()).toBeTruthy();
    const trainerToken = (await trainerLogin.json()).token;
    const adminLogin = await request.post('/api/auth/login', { data: CREDS.admin });
    const adminToken = (await adminLogin.json()).token;

    const created = await request.post('/api/trainings', {
      headers: { Authorization: `Bearer ${trainerToken}` },
      data: {
        name: `E2E Single-choice quiz ${Date.now()}`,
        category: 'Test',
        durationMinutes: 60,
        questions: [
          { text: 'Which option is correct?', options: ['wrong one', 'right one', 'other wrong'], correctIndices: [1], type: 'single' },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const training = await created.json();

    const roles = await request.get('/api/roles', { headers: { Authorization: `Bearer ${adminToken}` } });
    const lab = (await roles.json()).find((r: { name: string }) => r.name === 'Lab Technician');
    const assigned = await request.put(`/api/roles/${lab.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: lab.name, trainingIds: [...lab.trainingIds, training.id] },
    });
    expect(assigned.ok()).toBeTruthy();

    try {
      // Act as the learner: the quiz renders the single-choice question as a radio group.
      await login(page, 'member');
      await page.goto(`/session/${training.id}`);
      await page.getByRole('button', { name: 'Start test' }).click();
      await expect(page.getByText('Select the one correct answer.')).toBeVisible();
      const radios = page.locator('input[type="radio"]');
      await expect(radios).toHaveCount(3);
      expect(await page.locator('input[type="checkbox"]').count()).toBe(0);

      // Radio semantics: a second pick replaces the first instead of adding to it.
      await radios.nth(0).check();
      await radios.nth(1).check();
      await expect(radios.nth(0)).not.toBeChecked();
      await expect(radios.nth(1)).toBeChecked();

      // One selected answer answers the question — submit unlocks and the correct pick passes.
      const submit = page.getByRole('button', { name: 'Submit test' });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(page.getByText('step 3 of 3')).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Passed/ })).toBeVisible();
    } finally {
      // The specs share one seeded server — put the role back so this training does not appear on
      // the member's dashboard for the specs that run after this one.
      await request.put(`/api/roles/${lab.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { name: lab.name, trainingIds: lab.trainingIds },
      });
    }
  });
});

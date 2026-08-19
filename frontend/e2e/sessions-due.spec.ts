import { test, expect } from '@playwright/test';
import { CREDS, login, signSubmission } from './fixtures';

// E2E for the training-session flow (frontend SYS-SES-01, traced to SR-050 / VT-050) plus the
// dashboard due-status surface (SYS-DUE-02 / SR-060 / VT-060) and the retry affordance
// (SYS-SES-03 / SR-052 / VT-052). The seeded member holds the "Lab Technician" role requiring two
// trainings, so the dashboard always has at least one Start action.
//
// Server-side grading, persistence-of-passes-only, and the never/up-to-date/due/overdue computation
// are covered API-side in backend/tests/sessions-due.test.mjs; the answer key is never exposed to the
// client, so this spec drives the visible flow and asserts a pass/fail result screen appears.
test.describe('Training sessions & due status', () => {
  test('SYS-DUE-02 / SR-060 / VT-060: the dashboard lists the member\'s required trainings with status + Start', async ({ page }) => {
    await login(page, 'member');
    await expect(page).toHaveURL(/\/dashboard/);

    // Both seeded required trainings are shown as cards, each with a Start action and a status pill.
    await expect(page.getByRole('heading', { name: 'Laboratory Safety Basics' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quality Management Intro' })).toBeVisible();
    const starts = page.getByRole('button', { name: /Start/ });
    await expect(starts.first()).toBeVisible();
    expect(await starts.count()).toBeGreaterThanOrEqual(2);
  });

  test('SYS-SES-01 / SR-050 / VT-050: a member completes the material → quiz → result flow', async ({ page }) => {
    await login(page, 'member');

    // Start a session from the dashboard → routes to /session/:trainingId (step 1 of 3: material).
    await page.getByRole('button', { name: /Start/ }).first().click();
    await expect(page).toHaveURL(/\/session\//);
    await expect(page.getByTestId('session-material')).toBeVisible();

    // Step 1 — material: a learning-material link is shown and opens in a new tab (target=_blank).
    const materialLink = page.locator('a[target="_blank"]').first();
    await expect(materialLink).toBeVisible();
    await expect(materialLink).toHaveAttribute('rel', /noopener/);

    // Advance to the quiz (step 2 of 3) — through the materials confirmation (SR-162).
    await page.getByRole('button', { name: 'Start test' }).click();
    await page.getByTestId('confirm-materials-ok').click();
    await expect(page.getByTestId('session-quiz')).toBeVisible();

    // The quiz must NOT visually mark a correct answer (answer key hidden) — just selectable options.
    const questionCards = page.locator('section >> .card');
    expect(await questionCards.count()).toBeGreaterThanOrEqual(1);
    // The seeded questions are all multiple-choice, so every option is a checkbox and the learner is
    // never told how many answers are correct (SYS-SES-05) — no radios anywhere on an all-multiple
    // quiz. (Single-choice questions render radios instead — covered in questions-single.spec.ts.)
    expect(await page.locator('input[type="checkbox"]').count()).toBeGreaterThan(0);
    expect(await page.locator('input[type="radio"]').count()).toBe(0);

    // Submit is disabled until every question is answered.
    const submit = page.getByRole('button', { name: 'Submit test' });
    await expect(submit).toBeDisabled();

    // Answer every question by ticking its first option, then submit.
    const cards = await questionCards.all();
    for (const card of cards) {
      await card.locator('input[type="checkbox"]').first().check();
    }
    await expect(submit).toBeEnabled();
    await submit.click();
    // Every submission requires the completion signature (SR-173).
    await signSubmission(page, CREDS.member.password);

    // Step 3 — result: a pass/fail result screen with the score is shown (server-graded).
    await expect(page.getByTestId('session-result')).toBeVisible();
    await expect(page.getByText(/You scored \d+%/)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Passed|Not passed/ }),
    ).toBeVisible();
  });

  test('SYS-SES-03 / SR-052 / VT-052: a failing attempt offers a retry and notes failures aren\'t recorded', async ({ page }) => {
    await login(page, 'member');

    // Open the Laboratory Safety Basics session specifically (3 questions; first option is wrong,
    // so picking the first option for all three yields a guaranteed fail at the 80% threshold).
    await page.getByRole('button', { name: /Start/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Laboratory Safety Basics' })).toBeVisible();
    await page.getByRole('button', { name: 'Start test' }).click();
    await page.getByTestId('confirm-materials-ok').click();
    // Wait for the quiz step before snapshotting cards — .all() does not wait, and mid-transition
    // it captures the material step plus the confirmation dialog (itself a .card), so a stale
    // nth(3) card would never resolve once the dialog unmounts.
    await expect(page.getByTestId('session-quiz')).toBeVisible();

    const cards = await page.locator('section >> .card').all();
    for (const card of cards) {
      await card.locator('input[type="checkbox"]').first().check();
    }
    await page.getByRole('button', { name: 'Submit test' }).click();
    await signSubmission(page, CREDS.member.password);

    // Failing result shows the retry button and the "not recorded / stays due" note.
    await expect(page.getByRole('heading', { name: 'Not passed' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry test/ })).toBeVisible();
    await expect(page.getByText(/Failed attempts aren't recorded/)).toBeVisible();

    // Retry returns to the quiz step (unlimited retries).
    await page.getByRole('button', { name: /Retry test/ }).click();
    await expect(page.getByTestId('session-quiz')).toBeVisible();
  });
});

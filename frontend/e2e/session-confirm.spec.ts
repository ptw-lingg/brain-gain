import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login, publishSilent, signSubmission } from './fixtures';

// E2E for the materials confirmation before a test (SYS-SES-10 / SYS-AUD-09, traced to SR-162 /
// VT-173): starting a test first shows a dialog in which the learner confirms awareness of all
// provided materials — cancelling stays on the material step; a training WITHOUT questions is still
// startable and completes through that confirmation; the confirmations land in the audit trail.
// The endpoint's audit content and the empty-grading semantics are covered API-side in
// backend/tests/session-confirm.test.mjs.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Session start — materials confirmation', () => {
  test('SYS-SES-10 / SR-162 / VT-173: the dialog gates the test — cancel stays on the material step, confirm starts the quiz', async ({ page, request }) => {
    // The seeded member's first required training (has questions).
    const memberToken = await tokenFor(request, CREDS.member);
    const mine = await (await request.get('/api/trainings/mine', { headers: auth(memberToken) })).json();
    const training = mine.find((d: { training: { questions: unknown[] } }) => d.training.questions.length > 0).training;

    await login(page, 'member');
    await page.goto(`/session/${training.id}`);
    await expect(page.getByText('step 1 of 3')).toBeVisible();

    // Cancelling the dialog starts nothing.
    await page.getByTestId('session-start').click();
    const dialog = page.getByTestId('confirm-materials-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('I confirm that I am aware of all the materials provided');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('step 1 of 3')).toBeVisible();

    // Confirming records the confirmation and opens the quiz.
    await page.getByTestId('session-start').click();
    await page.getByTestId('confirm-materials-ok').click();
    await expect(page.getByText('step 2 of 3')).toBeVisible();
  });

  test('SYS-SES-10 / SR-162 / VT-173: a training without questions is startable and completes through the confirmation', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const memberToken = await tokenFor(request, CREDS.member);
    const name = `E2E Confirm Only ${Date.now()}`;
    let trainingId: string | null = null;
    let lab: { id: string; name: string; trainingIds: string[] } | null = null;
    try {
      // Arrange: a training with material but NO questions, assigned to the member's role.
      const created = await request.post('/api/trainings', {
        headers: auth(adminToken),
        data: {
          name,
          materials: [{ variants: [{ locale: 'en', label: 'Read me', url: 'https://example.com/readme' }] }],
          questions: [],
        },
      });
      expect(created.status()).toBe(201);
      trainingId = (await created.json()).id;
      await publishSilent(request, trainingId!, adminToken); // learners see published content only
      const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
      lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
      await request.put(`/api/roles/${lab!.id}`, {
        headers: auth(adminToken),
        data: { name: lab!.name, trainingIds: [...lab!.trainingIds, trainingId] },
      });

      // The dashboard card offers the start action despite the missing test.
      await login(page, 'member');
      const card = page.locator('.card', { hasText: name });
      await expect(card).toBeVisible();
      const start = card.getByRole('button', { name: 'Start' });
      await expect(start).toBeEnabled();
      await start.click();
      await expect(page).toHaveURL(new RegExp(`/session/${trainingId}`));

      // The session page explains the confirmation-based completion and completes through the dialog.
      await expect(page.getByText('This training has no test — confirming the materials completes it.')).toBeVisible();
      await page.getByTestId('session-start').click();
      const dialog = page.getByTestId('confirm-materials-dialog');
      await expect(dialog).toContainText('this confirmation is recorded as the evidence');
      // This confirmation COMPLETES the training, so it carries the completion signature (SR-173):
      // the confirm button stays disabled until the learner re-enters their password.
      await expect(page.getByTestId('confirm-materials-ok')).toBeDisabled();
      await dialog.getByTestId('signature-password').fill(CREDS.member.password);
      await page.getByTestId('confirm-materials-ok').click();

      await expect(page.getByRole('heading', { name: 'Passed' })).toBeVisible();
      await expect(page.getByText('Completed — your materials confirmation has been recorded.')).toBeVisible();

      // The confirmation is evidence in the audit trail: the member session above wrote it via the API.
      const audit = await (
        await request.get('/api/audit?action=materials-confirmed', { headers: auth(adminToken) })
      ).json();
      expect(
        audit.entries.some(
          (e: { entityId: string; actor: { email: string } | null }) =>
            e.entityId === trainingId && e.actor?.email === CREDS.member.email,
        ),
      ).toBeTruthy();
    } finally {
      if (lab) {
        await request.put(`/api/roles/${lab.id}`, {
          headers: auth(adminToken),
          data: { name: lab.name, trainingIds: lab.trainingIds },
        });
      }
      if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(adminToken) });
    }
  });

  test('SYS-SES-11 / SR-163 / VT-175: the trainer hint with name, unit and email shows in the dialog and on the failed result', async ({ page, request }) => {
    // Resolve the expected contact card through the same API the page uses — the seeded
    // "Laboratory Safety Basics" is owned by Tom Trainer.
    const memberToken = await tokenFor(request, CREDS.member);
    const mine = await (await request.get('/api/trainings/mine', { headers: auth(memberToken) })).json();
    const training = mine.find((d: { training: { questions: unknown[] } }) => d.training.questions.length > 0).training;
    const card = await (
      await request.get(`/api/trainings/${training.id}/trainer`, { headers: auth(memberToken) })
    ).json();
    expect(card.name).toBeTruthy();
    expect(card.email).toBe(CREDS.trainer.email);

    await login(page, 'member');
    await page.goto(`/session/${training.id}`);
    await page.getByTestId('session-start').click();

    // The dialog names the trainer with unit and mailto-linked email.
    const dialogHint = page.getByTestId('confirm-materials-dialog').getByTestId('trainer-contact');
    await expect(dialogHint).toContainText('Questions about this training?');
    await expect(dialogHint).toContainText(card.name);
    await expect(dialogHint).toContainText(card.orgUnitName);
    await expect(dialogHint.getByRole('link', { name: card.email })).toHaveAttribute('href', `mailto:${card.email}`);

    // Fail the test (first option of every seeded question is wrong) — the result screen repeats the hint.
    await page.getByTestId('confirm-materials-ok').click();
    // Wait for the quiz step before collecting the cards — querying mid-transition can capture the
    // closing confirmation dialog (also a .card) as a stale handle.
    await expect(page.getByText('step 2 of 3')).toBeVisible();
    for (const quizCard of await page.locator('section >> .card').all()) {
      await quizCard.locator('input[type="checkbox"]').first().check();
    }
    await page.getByRole('button', { name: 'Submit test' }).click();
    await signSubmission(page, CREDS.member.password); // the completion signature (SR-173)
    await expect(page.getByRole('heading', { name: 'Not passed' })).toBeVisible();
    const resultHint = page.getByTestId('trainer-contact');
    await expect(resultHint).toContainText(card.name);
    await expect(resultHint).toContainText(card.orgUnitName);
    await expect(resultHint).toContainText(card.email);
  });

  test('SYS-AUD-09 / SR-162 / VT-173: the audit page lists the materials confirmations under their own action filter', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/audit');
    await page.getByTestId('audit-filter-action').selectOption('materials-confirmed');
    const row = page.getByTestId('audit-row-materials-confirmed').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Materials confirmed');
    await expect(row).toContainText(CREDS.member.email);
  });
});

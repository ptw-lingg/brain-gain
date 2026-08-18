import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login, publishSilent, signSubmission } from './fixtures';

// E2E for localized quiz questions and answers (SR-155): per-language authoring in the editor
// (SYS-TRN-16) and the learner's quiz resolving to their chosen language with the material fallback
// logic and the shown language's flag (SYS-SES-09); traced to VT-162. Sanitization, the
// answer-key remapping and the boot migration are covered API-side in
// backend/tests/questions-locale.test.mjs.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Localized quiz questions', () => {
  test('SYS-TRN-16 / SR-155 / VT-162: a trainer authors a question and its answers in English and German', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');

    const name = `E2E localized question ${Date.now()}`;
    await page.getByRole('button', { name: 'Add Training' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Training name').first().fill(name);
    await dialog.getByRole('button', { name: /Quiz questions/ }).click();
    await dialog.getByRole('button', { name: 'Add question' }).click();

    // One input per language for the text and for every answer (EN row first, then DE).
    await dialog.getByPlaceholder('Question 1').nth(0).fill('What is the purpose?');
    await dialog.getByPlaceholder('Question 1').nth(1).fill('Wozu dient das?');
    await dialog.getByPlaceholder('Option 1').nth(0).fill('To define requirements');
    await dialog.getByPlaceholder('Option 1').nth(1).fill('Anforderungen festlegen');
    await dialog.getByPlaceholder('Option 2').nth(0).fill('To create marketing');
    await dialog.getByPlaceholder('Option 2').nth(1).fill('Werbung erstellen');
    await dialog.getByRole('button', { name: 'Create' }).click();
    // The created content is staged as a draft — the publish step is offered; keep it a draft here.
    await page.getByTestId('publish-update-skip').click();
    await expect(page.getByText(name)).toBeVisible();

    // Round-trip: both languages come back into their rows.
    await page.reload();
    await page.getByText(name).click();
    const reopened = page.getByRole('dialog');
    await reopened.getByRole('button', { name: /Quiz questions/ }).click();
    await reopened.getByRole('button', { name: /What is the purpose\?/ }).click();
    await expect(reopened.getByPlaceholder('Question 1').nth(1)).toHaveValue('Wozu dient das?');
    await expect(reopened.getByPlaceholder('Option 1').nth(0)).toHaveValue('To define requirements');
    await expect(reopened.getByPlaceholder('Option 2').nth(1)).toHaveValue('Werbung erstellen');

    // The collapsed-row title prefers English but falls back to any filled language — clearing the
    // English text must surface the German one, not the "Question 1" placeholder. Not saved.
    await reopened.getByPlaceholder('Question 1').nth(0).fill('');
    await expect(reopened.getByRole('button', { name: /1\. Wozu dient das\?/ })).toBeVisible();
  });

  test('SYS-SES-09 / SR-155 / VT-162: the learner takes the quiz in their language, with a language flag where it is missing', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const memberToken = await tokenFor(request, CREDS.member);
    let trainingId: string | null = null;
    let lab: { id: string; name: string; trainingIds: string[] } | null = null;
    try {
      await request.put('/api/auth/me', { headers: auth(memberToken), data: { locale: 'de' } });
      const created = await request.post('/api/trainings', {
        headers: auth(trainerToken),
        data: {
          name: `E2E quiz language ${Date.now()}`,
          questions: [
            {
              text: { de: 'Deutsche Frage?', en: 'German question?' },
              options: [{ de: 'richtig', en: 'right' }, { de: 'falsch', en: 'wrong' }],
              correctIndices: [0],
              type: 'single',
            },
            {
              text: { en: 'English-only question?' },
              options: [{ en: 'yes' }, { en: 'no' }],
              correctIndices: [0],
              type: 'single',
            },
          ],
        },
      });
      expect(created.status()).toBe(201);
      trainingId = (await created.json()).id;
      await publishSilent(request, trainingId!, trainerToken); // learners see published content only

      const roles = await request.get('/api/roles', { headers: auth(adminToken) });
      lab = (await roles.json()).find((r: { name: string }) => r.name === 'Lab Technician');
      await request.put(`/api/roles/${lab!.id}`, {
        headers: auth(adminToken),
        data: { name: lab!.name, trainingIds: [...lab!.trainingIds, trainingId] },
      });

      await login(page, 'member');
      await page.goto(`/session/${trainingId}`);
      await page.getByRole('button', { name: /Test starten/ }).click(); // profile de → German UI
      await page.getByTestId('confirm-materials-ok').click(); // materials confirmation (SR-162)

      // The DE+EN question renders in German (no flag); the EN-only one falls back wearing the
      // English flag as the only alternative-language marker.
      await expect(page.getByText('Deutsche Frage?')).toBeVisible();
      await expect(page.getByText('richtig', { exact: true })).toBeVisible();
      await expect(page.getByText('English-only question?')).toBeVisible();
      await expect(page.locator('main .fi.fi-us')).toHaveCount(1);
      await expect(page.locator('main .fi.fi-de')).toHaveCount(0);

      // Grading is index-based whatever the language: answer both correctly and pass.
      await page.locator('input[name="q-0"]').nth(0).check();
      await page.locator('input[name="q-1"]').nth(0).check();
      await page.getByRole('button', { name: 'Test abgeben' }).click();
      await signSubmission(page, CREDS.member.password); // the completion signature (SR-173), German UI
      await expect(page.getByRole('heading', { name: /^Bestanden/ })).toBeVisible();
    } finally {
      if (lab) {
        await request.put(`/api/roles/${lab.id}`, {
          headers: auth(adminToken),
          data: { name: lab.name, trainingIds: lab.trainingIds },
        });
      }
      if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) });
      await request.put('/api/auth/me', { headers: auth(memberToken), data: { locale: 'en' } });
    }
  });

  test('SYS-SES-09 / SR-155 / VT-162: a German-only question shows the English learner the German text with its flag', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const trainerToken = await tokenFor(request, CREDS.trainer);
    let trainingId: string | null = null;
    let lab: { id: string; name: string; trainingIds: string[] } | null = null;
    try {
      const created = await request.post('/api/trainings', {
        headers: auth(trainerToken),
        data: {
          name: `E2E quiz language reverse ${Date.now()}`,
          questions: [
            {
              text: { de: 'Nur deutsche Frage?' },
              options: [{ de: 'ja' }, { de: 'nein' }],
              correctIndices: [0],
              type: 'single',
            },
          ],
        },
      });
      expect(created.status()).toBe(201);
      trainingId = (await created.json()).id;
      await publishSilent(request, trainingId!, trainerToken);

      const roles = await request.get('/api/roles', { headers: auth(adminToken) });
      lab = (await roles.json()).find((r: { name: string }) => r.name === 'Lab Technician');
      await request.put(`/api/roles/${lab!.id}`, {
        headers: auth(adminToken),
        data: { name: lab!.name, trainingIds: [...lab!.trainingIds, trainingId] },
      });

      // The member's profile language is English (the default). The German-only text has no
      // English fallback, so it is shown as-is — wearing the German flag as the marker.
      await login(page, 'member');
      await page.goto(`/session/${trainingId}`);
      await page.getByRole('button', { name: /Start test/ }).click();
      await page.getByTestId('confirm-materials-ok').click();

      await expect(page.getByText('Nur deutsche Frage?')).toBeVisible();
      await expect(page.getByText('ja', { exact: true })).toBeVisible();
      await expect(page.locator('main .fi.fi-de')).toHaveCount(1);
      await expect(page.locator('main .fi.fi-us')).toHaveCount(0);
    } finally {
      if (lab) {
        await request.put(`/api/roles/${lab.id}`, {
          headers: auth(adminToken),
          data: { name: lab.name, trainingIds: lab.trainingIds },
        });
      }
      if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) });
    }
  });
});

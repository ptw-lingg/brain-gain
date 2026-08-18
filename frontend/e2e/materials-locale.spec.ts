import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login, publishSilent } from './fixtures';

// E2E for localized training material (SR-152/154): per-language authoring in the editor
// (SYS-TRN-15), the learner's material resolving to the UI language — the ONE language switch —
// with English fallback and the "alternative language" badge + flag on non-matching cards only
// (SYS-SES-08, SYS-UI-09), and the persisted profile language behind the flagged switch
// (SYS-AUTH-10). Sanitization and migration are covered API-side in
// backend/tests/materials-locale.test.mjs; content languages are fixed to English and German.
//
// The specs share one seeded server — every test restores the state it changes in `finally`.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Localized training material', () => {
  test('SYS-TRN-15 / SR-152 / VT-156: a trainer authors English and German variants of one material and the summary reports both', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');

    const name = `E2E localized material ${Date.now()}`;
    await page.getByRole('button', { name: 'Add Training' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Training name').first().fill(name);

    // One material, one row per language — each with its own label and link.
    await dialog.getByRole('button', { name: /Learning material/ }).click();
    await dialog.getByRole('button', { name: 'Add material' }).click();
    const labels = dialog.getByPlaceholder('Label');
    const urls = dialog.getByPlaceholder('https://…');
    await labels.nth(0).fill('Safety Handbook');
    await urls.nth(0).fill('https://docs.example.com/handbook-en');
    await labels.nth(1).fill('Sicherheitshandbuch');
    await urls.nth(1).fill('https://docs.example.com/handbuch-de');
    await dialog.getByRole('button', { name: 'Create' }).click();
    // The created content is staged as a draft — the publish step is offered; keep it a draft here.
    await page.getByTestId('publish-update-skip').click();
    await expect(page.getByText(name)).toBeVisible();

    // Round-trip: the collapsed section summary reports the material and both languages.
    await page.reload();
    await page.getByText(name).click();
    const reopened = page.getByRole('dialog');
    const summary = reopened.getByRole('button', { name: /Learning material/ });
    await expect(summary).toContainText('1 material');
    await expect(summary).toContainText('EN DE');
    await reopened.getByRole('button', { name: /Learning material/ }).click();
    await expect(reopened.getByPlaceholder('Label').nth(1)).toHaveValue('Sicherheitshandbuch');
    await expect(reopened.getByPlaceholder('https://…').nth(1)).toHaveValue('https://docs.example.com/handbuch-de');
  });

  test('SYS-SES-08 / SR-152 / VT-156 / SYS-UI-09: material follows the UI language — matching cards unadorned, alternatives get the language flag', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const memberToken = await tokenFor(request, CREDS.member);
    let trainingId: string | null = null;
    let lab: { id: string; name: string; trainingIds: string[] } | null = null;
    try {
      // The member's language is German — the ONE switch that governs UI and content alike.
      await request.put('/api/auth/me', { headers: auth(memberToken), data: { locale: 'de' } });

      const created = await request.post('/api/trainings', {
        headers: auth(trainerToken),
        data: {
          name: `E2E locale resolution ${Date.now()}`,
          materials: [
            {
              variants: [
                { locale: 'en', label: 'Handbook (English)', url: 'https://docs.example.com/en' },
                { locale: 'de', label: 'Handbuch (Deutsch)', url: 'https://docs.example.com/de' },
              ],
            },
            { variants: [{ locale: 'en', label: 'English-only guide', url: 'https://docs.example.com/en-only' }] },
          ],
          questions: [{ text: 'Q', options: ['right', 'wrong'], correctIndices: [0], type: 'single' }],
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

      // DE+EN material → the German variant, no flag; the EN-only material stands in wearing its
      // language flag as the only alternative-language marker.
      await expect(page.getByText('Handbuch (Deutsch)')).toBeVisible();
      await expect(page.getByText('Handbook (English)')).toHaveCount(0);
      await expect(page.getByText('English-only guide')).toBeVisible();
      await expect(page.locator('main .fi.fi-us')).toHaveCount(1);
      await expect(page.locator('main .fi.fi-de')).toHaveCount(0); // a matching material carries no flag
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

  test('SYS-AUTH-10 / SR-154 / VT-160 / SYS-UI-09: the flagged language switch persists the choice and it is applied at the next sign-in', async ({ page, request }) => {
    const memberToken = await tokenFor(request, CREDS.member);
    try {
      await login(page, 'member');

      // The user-menu switch is a flagged dropdown; picking Deutsch flips the UI at once — and the
      // flag beside the dropdown follows the choice.
      await page.getByRole('button', { name: 'User menu' }).click();
      await expect(page.locator('.fi.fi-us')).toBeVisible();
      await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
      await expect(page.getByRole('link', { name: 'Meine Schulungen' })).toBeVisible();
      await expect(page.locator('.fi.fi-de')).toBeVisible();

      // …and the choice is persisted to the profile: a FRESH sign-in comes up in German.
      // (The menu stayed open — the language dropdown lives inside it; logout is a menu item.)
      await page.getByRole('menuitem', { name: 'Abmelden' }).click();
      await page.waitForURL('**/login');
      await page.evaluate(() => localStorage.removeItem('braingain.locale')); // forget the browser copy — only the profile remains
      await login(page, 'member');
      await expect(page.getByRole('link', { name: 'Meine Schulungen' })).toBeVisible();
    } finally {
      // A leaked German UI would break every later English-locator spec.
      await request.put('/api/auth/me', { headers: auth(memberToken), data: { locale: 'en' } });
    }
  });
});

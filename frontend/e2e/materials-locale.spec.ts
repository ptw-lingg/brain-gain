import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for localized training material (SR-152/153/154): the Settings language list with flags and
// its delete guard (SYS-SET-05), per-locale authoring in the editor (SYS-TRN-15), the learner's
// material-language picker with its chosen → English → all-variants resolution (SYS-SES-08), and the
// persisted profile language behind the flagged switch (SYS-AUTH-10, SYS-UI-09). Sanitization,
// migration and endpoint contracts are covered API-side in backend/tests/materials-locale.test.mjs,
// settings-locales.test.mjs and profile-locale.test.mjs.
//
// The specs share one seeded server — every test restores the state it changes in `finally`
// (settings list, member profile locale, role assignments, scratch trainings).

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Localized training material', () => {
  test('SYS-SET-05 / SR-153 / VT-158 / SYS-UI-09: the Settings card lists material languages with flags and English cannot be removed', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');

    const card = page.locator('.card', { hasText: 'Training material languages' });
    await expect(card).toBeVisible();

    // Both default languages are listed with their flags (SVG flag classes, not emoji).
    await expect(card.locator('.fi.fi-us')).toBeVisible();
    await expect(card.locator('.fi.fi-de')).toBeVisible();
    await expect(card.getByText('English', { exact: true })).toBeVisible();
    await expect(card.getByText('Deutsch', { exact: true })).toBeVisible();

    // English is the fixed default: badge instead of a delete button.
    await expect(card.getByText('Default & fallback')).toBeVisible();
    const deleteButtons = card.getByRole('button', { name: 'Remove language' });
    await expect(deleteButtons).toHaveCount(1); // only Deutsch is deletable, English is not
  });

  test('SYS-SET-05 / SR-153 / VT-158: removing a used language is refused with the transparent server message', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const trainerToken = await tokenFor(request, CREDS.trainer);
    let trainingId: string | null = null;
    try {
      await login(page, 'admin');
      await page.goto('/settings');
      const card = page.locator('.card', { hasText: 'Training material languages' });

      // Add French from the catalog…
      await card.getByRole('combobox').selectOption('fr');
      await card.getByRole('button', { name: 'Add' }).click();
      await expect(card.getByText('Français', { exact: true })).toBeVisible();

      // …and let a training use it.
      const created = await request.post('/api/trainings', {
        headers: auth(trainerToken),
        data: {
          name: `E2E uses French ${Date.now()}`,
          materials: [{ variants: [{ locale: 'fr', label: 'Manuel', url: 'https://docs.example.com/fr' }] }],
        },
      });
      expect(created.status()).toBe(201);
      trainingId = (await created.json()).id;

      // The removal is refused, and the toast carries the server's message naming language and usage.
      const frenchRow = card.locator('div.flex.items-center', { hasText: 'Français' }).first();
      await frenchRow.getByRole('button', { name: 'Remove language' }).click();
      await frenchRow.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText(/Cannot remove Français \(fr\): 1 material in 1 training/)).toBeVisible();
      await expect(card.getByText('Français', { exact: true })).toBeVisible();

      // Once the training is gone the language is unused — now the removal succeeds.
      // (The exact-text check ignores the "Français (fr)" entry inside the add-dropdown.)
      await request.delete(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) });
      trainingId = null;
      await frenchRow.getByRole('button', { name: 'Remove language' }).click();
      await frenchRow.getByRole('button', { name: 'Delete' }).click();
      await expect(card.getByText('Français', { exact: true })).toHaveCount(0);
    } finally {
      if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) });
      await request.put('/api/settings', { headers: auth(adminToken), data: { materialLocales: ['en', 'de'] } });
    }
  });

  test('SYS-TRN-15 / SR-152 / VT-156: a trainer authors English and German variants of one material and the summary reports both', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');

    const name = `E2E localized material ${Date.now()}`;
    await page.getByRole('button', { name: 'Add Training' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Training name').fill(name);

    // One material, one row per configured language — each with its own label and link.
    await dialog.getByRole('button', { name: /Learning material/ }).click();
    await dialog.getByRole('button', { name: 'Add material' }).click();
    const labels = dialog.getByPlaceholder('Label');
    const urls = dialog.getByPlaceholder('https://…');
    await labels.nth(0).fill('Safety Handbook');
    await urls.nth(0).fill('https://docs.example.com/handbook-en');
    await labels.nth(1).fill('Sicherheitshandbuch');
    await urls.nth(1).fill('https://docs.example.com/handbuch-de');
    await dialog.getByRole('button', { name: 'Create' }).click();
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

  test('SYS-SES-08 / SR-152 / VT-156: the learner picker defaults to the profile language, falls back to English, and offers all variants when neither exists', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const memberToken = await tokenFor(request, CREDS.member);
    let trainingId: string | null = null;
    let lab: { id: string; name: string; trainingIds: string[] } | null = null;
    try {
      // French must be configured for the fr-only material; the member prefers German.
      await request.put('/api/settings', { headers: auth(adminToken), data: { materialLocales: ['en', 'de', 'fr'] } });
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
            { variants: [{ locale: 'fr', label: 'Guide français', url: 'https://docs.example.com/fr-only' }] },
          ],
          questions: [{ text: 'Q', options: ['right', 'wrong'], correctIndices: [0], type: 'single' }],
        },
      });
      expect(created.status()).toBe(201);
      trainingId = (await created.json()).id;

      const roles = await request.get('/api/roles', { headers: auth(adminToken) });
      lab = (await roles.json()).find((r: { name: string }) => r.name === 'Lab Technician');
      await request.put(`/api/roles/${lab!.id}`, {
        headers: auth(adminToken),
        data: { name: lab!.name, trainingIds: [...lab!.trainingIds, trainingId] },
      });

      await login(page, 'member');
      await page.goto(`/session/${trainingId}`);

      // The picker defaults to the member's profile language (DE, pressed pill with the German flag).
      const dePill = page.getByRole('button', { name: 'Deutsch' });
      await expect(dePill).toHaveAttribute('aria-pressed', 'true');

      // DE+EN material → the German variant (no badge); EN-only material → English stand-in;
      // FR-only material → its variant offered anyway. Everything not in the chosen language wears
      // the "alternative language" badge. Note the profile language also switched the UI to German,
      // so the i18n'd badge is asserted in German.
      await expect(page.getByText('Handbuch (Deutsch)')).toBeVisible();
      await expect(page.getByText('Handbook (English)')).toHaveCount(0);
      await expect(page.getByText('English-only guide')).toBeVisible();
      await expect(page.getByText('Guide français')).toBeVisible();
      await expect(page.getByText('Alternative Sprache')).toHaveCount(2);

      // Switching the picker re-resolves per material — now only the French card is an alternative.
      await page.getByRole('button', { name: 'English' }).click();
      await expect(page.getByText('Handbook (English)')).toBeVisible();
      await expect(page.getByText('Handbuch (Deutsch)')).toHaveCount(0);
      await expect(page.getByText('Alternative Sprache')).toHaveCount(1);
    } finally {
      if (lab) {
        await request.put(`/api/roles/${lab.id}`, {
          headers: auth(adminToken),
          data: { name: lab.name, trainingIds: lab.trainingIds },
        });
      }
      if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) });
      await request.put('/api/settings', { headers: auth(adminToken), data: { materialLocales: ['en', 'de'] } });
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
      // (The menu stayed open — the language buttons live inside it; logout is a menu item.)
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

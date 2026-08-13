import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for localized training master data (SR-157): per-language name/category/description authoring
// in the editor's Basics section (SYS-TRN-17) and the learner's dashboard card showing the name in
// the user's language — the ONE language switch — with English fallback (SYS-DATA-13). Sanitization
// and the boot migration are covered API-side in backend/tests/trainings-locale.test.mjs; content
// languages are fixed to English and German.
//
// The specs share one seeded server — every test restores the state it changes in `finally`.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Localized training master data', () => {
  test('SYS-TRN-17 / SYS-DATA-13 / SR-157 / VT-165: a trainer authors a DE+EN name; a German member sees the German name on their dashboard card', async ({ page, request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const trainerToken = await tokenFor(request, CREDS.trainer);
    const memberToken = await tokenFor(request, CREDS.member);
    const stamp = Date.now();
    const enName = `E2E Procurement ${stamp}`;
    const deName = `E2E Beschaffung ${stamp}`;
    let trainingId: string | null = null;
    let lab: { id: string; name: string; trainingIds: string[] } | null = null;
    try {
      // Author the name in both languages via the per-language rows in the Basics section.
      await login(page, 'trainer');
      await page.goto('/trainings');
      await page.getByRole('button', { name: 'Add Training' }).click();
      const dialog = page.getByRole('dialog');
      const nameInputs = dialog.getByPlaceholder('Training name');
      await nameInputs.nth(0).fill(enName); // row order = the fixed locale list: en first,
      await nameInputs.nth(1).fill(deName); // then de
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(page.getByText(enName)).toBeVisible(); // trainer UI is English → English name listed

      // Round-trip: reopening the editor shows both values in their own language rows.
      await page.getByText(enName).click();
      const reopened = page.getByRole('dialog');
      await expect(reopened.getByPlaceholder('Training name').nth(0)).toHaveValue(enName);
      await expect(reopened.getByPlaceholder('Training name').nth(1)).toHaveValue(deName);
      await page.keyboard.press('Escape');

      // Require the new training from the member (via the seeded Lab Technician role) and make the
      // member's profile language German — the ONE switch that governs UI and content alike.
      const trainings = await request.get('/api/trainings', { headers: auth(trainerToken) });
      trainingId = (await trainings.json()).find((t: { name: { en?: string } }) => t.name.en === enName)?.id;
      expect(trainingId).toBeTruthy();
      const roles = await request.get('/api/roles', { headers: auth(adminToken) });
      lab = (await roles.json()).find((r: { name: string }) => r.name === 'Lab Technician');
      await request.put(`/api/roles/${lab!.id}`, {
        headers: auth(adminToken),
        data: { name: lab!.name, trainingIds: [...lab!.trainingIds, trainingId] },
      });
      await request.put('/api/auth/me', { headers: auth(memberToken), data: { locale: 'de' } });

      // The member's dashboard card shows the German name — the English one appears nowhere.
      await page.context().clearCookies();
      await login(page, 'member');
      await expect(page.getByRole('heading', { name: deName })).toBeVisible();
      await expect(page.getByText(enName)).toHaveCount(0);
    } finally {
      if (lab) {
        await request.put(`/api/roles/${lab.id}`, {
          headers: auth(adminToken),
          data: { name: lab.name, trainingIds: lab.trainingIds },
        });
      }
      if (trainingId) await request.delete(`/api/trainings/${trainingId}`, { headers: auth(trainerToken) });
      // A leaked German UI would break every later English-locator spec.
      await request.put('/api/auth/me', { headers: auth(memberToken), data: { locale: 'en' } });
    }
  });
});

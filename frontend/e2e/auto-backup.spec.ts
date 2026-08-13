import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for the automatic-backup settings card (SYS-BAK-10 / SR-158 / VT-167): the admin Settings page
// carries its own card with the shipped defaults (disabled / every 7 days / keep 5), and enabling the
// schedule with new values persists across a reload. The scheduler itself (boot catch-up, retention,
// the 'auto' backup source) is covered API-side in backend/tests/auto-backup.test.mjs.
//
// The specs share one seeded server — the changed schedule is restored in `finally` so no later spec
// meets a server that quietly starts creating backups.

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', { data: CREDS.admin });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

test.describe('Settings — automatic backups', () => {
  test('SYS-BAK-10 / SR-158 / VT-167: the automatic-backup card shows the defaults and a saved schedule survives a reload', async ({ page, request }) => {
    const token = await adminToken(request);
    try {
      await login(page, 'admin');
      await page.goto('/settings');

      const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Automatic backups' }) });
      await expect(card).toBeVisible();

      // Shipped defaults: off, back up every 7 days, keep 5 automatic backups.
      await expect(card.getByRole('checkbox')).not.toBeChecked();
      await expect(card.getByLabel('Back up every (days)')).toHaveValue('7');
      await expect(card.getByLabel('Automatic backups to keep')).toHaveValue('5');

      // Enable and change the schedule.
      await card.getByRole('checkbox').check();
      await card.getByLabel('Back up every (days)').fill('3');
      await card.getByLabel('Automatic backups to keep').fill('2');
      await card.getByRole('button', { name: 'Save backup schedule' }).click();
      await expect(page.getByText('Backup schedule saved')).toBeVisible();

      // A reload re-fetches GET /settings — the persisted schedule must come back.
      await page.reload();
      const reloaded = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Automatic backups' }) });
      await expect(reloaded.getByRole('checkbox')).toBeChecked();
      await expect(reloaded.getByLabel('Back up every (days)')).toHaveValue('3');
      await expect(reloaded.getByLabel('Automatic backups to keep')).toHaveValue('2');
    } finally {
      // Back to the shipped defaults — later specs must not run against an auto-backing-up server.
      await request.put('/api/settings', {
        headers: { Authorization: `Bearer ${token}` },
        data: { autoBackup: { enabled: false, intervalDays: 7, keep: 5 } },
      });
    }
  });
});

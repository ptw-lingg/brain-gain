import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2e spec for the Settings requirement area (SYS areas: SET), traced to stakeholder reqs
//   SR-080  Global pass threshold (VT-080)
//   SR-081  Manage SSO from the Settings area (VT-008)
// covering SYS-SET-03 (Settings page cards) and the admin-only access of SYS-SET-01/02.
//
// The pass-threshold card uses a range slider (min 50, max 100, step 5) whose live value is shown as
// a percentage (e.g. "80%"); "Save changes" PUTs passThreshold = pct/100. A reload re-fetches the
// settings, so the slider/label must come back at the saved value.
test.describe('Settings — global pass threshold', () => {
  test('SR-081 / SYS-SET-03: admin sees the pass-threshold and SSO cards', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Global pass threshold' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Microsoft Entra ID (SSO)' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save changes/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save SSO settings/ })).toBeVisible();
  });

  test('SR-080 / VT-080 / SYS-SET-03: admin edits the global pass threshold and it persists across a reload', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');

    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();

    // Seed default is 0.8 → the slider/label start at 80%.
    await expect(slider).toHaveValue('80');
    await expect(page.getByText('80%')).toBeVisible();

    // Move the slider to 65% (min 50, max 100, step 5). fill() sets the value and fires input/change.
    await slider.fill('65');
    await expect(slider).toHaveValue('65');
    await expect(page.getByText('65%')).toBeVisible();

    await page.getByRole('button', { name: /Save changes/ }).click();
    // Success toast confirms the PUT round-trip.
    await expect(page.getByText('Pass threshold updated for all trainings')).toBeVisible();

    // Reload re-fetches GET /settings; the persisted 65% must come back.
    await page.reload();
    await expect(page.locator('input[type="range"]')).toHaveValue('65');
    await expect(page.getByText('65%')).toBeVisible();
  });

  test('SR-003 / SYS-SET-01: a member cannot reach the admin-only Settings page', async ({ page }) => {
    await login(page, 'member');
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for the clipboard user-import UI and the activation page it feeds (SYS-USR-03 / SYS-AUTH-09,
// traced to SR-023..SR-027 / VT-023, VT-024, VT-027): paste → dry-run preview → import → the issued
// activation link actually activates the account. Matching rules, token one-time-ness and the guards
// are covered API-side in backend/tests/users-import.test.mjs.

test.describe('Users import & activation', () => {
  test('SYS-AC-02 / SR-003: /users/import is admin-only — a trainer is bounced to the dashboard', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/users/import');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('SYS-USR-03 / SYS-AUTH-09 / SR-023 / VT-023 / VT-024 / VT-027: paste → preview → import → the new user activates via the issued link', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users/import');
    await expect(page.getByRole('heading', { name: 'Import Users' })).toBeVisible();

    // Paste one new user as tab-separated row data (the Excel-paste shape) and preview.
    const stamp = Date.now();
    const email = `e2e.import.${stamp}@test.local`;
    await page.locator('textarea').fill(`Ivy Imported\t${email}\tLab Technician`);
    await page.getByRole('button', { name: 'Preview changes' }).click();

    // The dry-run plan marks the row as a create; nothing is committed yet.
    await expect(page.getByText('1 new')).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // Import — the summary confirms and the activation link for the created user is offered.
    await page.getByRole('button', { name: /Import 1 user/ }).click();
    await expect(page.getByText('Activation links')).toBeVisible();
    const link = page.locator(`text=/activate\\?token=/`).first();
    const url = (await link.textContent())?.trim();
    expect(url, 'an activation URL is shown for the created user').toMatch(/\/activate\?token=.+/);

    // Follow the link in a signed-out session: the activation page sets a password and signs in.
    await page.context().clearCookies();
    await page.goto(url!.slice(url!.indexOf('/activate')));
    await expect(page.getByRole('heading', { name: 'Activate your account' })).toBeVisible();
    await page.getByLabel('New password').fill('freshpass123');
    await page.getByLabel('Confirm password').fill('freshpass123');
    await page.getByRole('button', { name: 'Set password & sign in' }).click();

    // Activation auto-signs-in: the new member lands on their dashboard with the member navigation.
    await page.waitForURL('**/dashboard');
    await expect(page.locator('aside')).toContainText('My Trainings');
  });
});

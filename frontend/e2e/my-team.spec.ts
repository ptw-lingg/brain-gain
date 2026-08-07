import { test, expect } from '@playwright/test';
import { login, CREDS } from './fixtures';

// E2E for the head-scoped My Team view (SYS-ORG-05 UI surface, traced to SR-127 / VT-127): the
// requiresHeadOrAdmin router guard's isHead branch — a NON-admin user gains access exactly when an
// admin makes them head of a unit. (The admin path and the member redirect live in team-report.spec.ts;
// the oversight data itself is covered API-side in backend/tests/org-units.test.mjs.)

test.describe('My Team — head access', () => {
  test('SYS-ORG-05 / SR-127 / VT-127: a trainer cannot open My Team until an admin makes them head of a unit', async ({ page }) => {
    // Before being a head: the trainer is bounced by the guard (they are neither admin nor head).
    await login(page, 'trainer');
    await page.goto('/my-team');
    await expect(page).toHaveURL(/\/dashboard/);

    // An admin creates a unit with the trainer as its responsible head.
    await page.context().clearCookies();
    await login(page, 'admin');
    await page.goto('/org-units');
    const unit = `E2E Head Unit ${Date.now()}`;
    await page.getByRole('button', { name: 'Add Unit' }).click();
    await page.getByPlaceholder('e.g. Research & Development').fill(unit);
    await page.getByLabel('Head').selectOption({ label: `Tom Trainer (${CREDS.trainer.email})` });
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(unit)).toBeVisible();

    // Now the trainer is a head: the guard admits them and the sidebar offers My Team.
    await page.context().clearCookies();
    await login(page, 'trainer');
    await page.goto('/my-team');
    await expect(page).toHaveURL(/\/my-team/);
    await expect(page.getByRole('heading', { name: 'My Team' })).toBeVisible();

    // Cleanup + the reverse direction: the admin removes the head again, and the trainer loses access
    // (later specs rely on the seeded trainer heading no unit).
    await page.context().clearCookies();
    await login(page, 'admin');
    await page.goto('/org-units');
    await page.getByText(unit).click();
    await page.getByLabel('Head').selectOption({ label: '— none —' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(unit)).toBeVisible();

    await page.context().clearCookies();
    await login(page, 'trainer');
    await page.goto('/my-team');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

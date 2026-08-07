import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for the admin "view as" session (SYS-AC-09, traced to SR-011 / VT-011): start impersonation from
// the user editor, see the app exactly as the member (banner + member-gated navigation), and return to
// the admin session. Token issuance and its guards are covered API-side in
// backend/tests/impersonation.test.mjs (SYS-AC-07/08 / VT-012).

test.describe('Impersonation — view as', () => {
  test('SYS-AC-09 / SR-011 / VT-011: an admin views the app as a member and returns to their own session', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');

    // Open the member's editor and start the view-as session.
    await page.getByRole('row', { name: /Uma User/ }).click();
    await page.getByRole('button', { name: 'View as' }).click();

    // The impersonated session lands on the member's dashboard with the persistent banner…
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('Viewing as')).toBeVisible();
    await expect(page.getByText('Uma User').first()).toBeVisible();
    // …and the navigation is the member's, not the admin's (role-gated while viewing as).
    const aside = page.locator('aside');
    await expect(aside).toContainText('My Trainings');
    await expect(aside).not.toContainText('Users');
    await expect(aside).not.toContainText('Settings');

    // Stop returns to the admin identity: banner gone, admin pages reachable again.
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Viewing as')).toHaveCount(0);
    await page.goto('/users');
    await expect(page).toHaveURL(/\/users/);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  });
});

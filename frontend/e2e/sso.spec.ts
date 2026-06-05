import { test, expect } from '@playwright/test';

// e2e spec for Microsoft Entra ID SSO — the UI-observable part.
//   SYS-SSO-02 / VT-007 : the login page shows the "Sign in with Microsoft" button ONLY when SSO is
//     enabled. The shared test server is seeded with Entra SSO disabled (entra.enabled = false), so
//     the button must be hidden and the app behaves as a password-only app (SR-007 / SR-010).
//
// The actual Microsoft popup → ID-token → provisioning flow (SR-006 / VT-006, VT-009) requires a real
// Entra tenant and is documented as a MANUAL procedure in requirements/manual-tests/sso.md.
test.describe('Microsoft Entra ID SSO (UI)', () => {
  test('SYS-SSO-02 / VT-007: with SSO disabled, the "Sign in with Microsoft" button is NOT shown on /login', async ({ page }) => {
    await page.goto('/login');

    // The password form is present (the app is fully usable as password-only).
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // The SSO button lives inside a v-if="ssoEnabled" block, so it is not rendered while disabled.
    await expect(page.getByRole('button', { name: /Sign in with Microsoft/i })).toHaveCount(0);
    // The "or" divider that introduces the SSO option is likewise absent.
    await expect(page.getByText('Sign in with Microsoft')).toHaveCount(0);
  });

  test('SR-007 / SR-010: with SSO disabled, password login still works (password-only behaviour)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'user@braingain.app');
    await page.fill('input[type="password"]', 'user123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

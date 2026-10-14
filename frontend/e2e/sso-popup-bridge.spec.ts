import { test, expect } from '@playwright/test';

// Microsoft sign-in (msal-browser 5): the popup returns to the app's origin with the authorisation
// response in the URL, and that page must relay it to the main window through MSAL's redirect bridge
// (main.ts) — for the login and for the completion signature's re-login alike (SYS-SSO-10, SR-006).
// The regression this guards: the app booting inside the popup, the router redirecting it to /login,
// and the response being swallowed — the popup then shows the login page forever.
//
// A real Entra round trip cannot run here, so this drives the page the popup lands on with a
// response-shaped URL whose state no MSAL instance issued. What must hold: the app does NOT boot
// (no redirect to /login, no login form), and the bridge's refusal is said in words.

test.describe('Microsoft sign-in popup bridge', () => {
  for (const where of ['query', 'fragment'] as const) {
    test(`SYS-SSO-10 / VT-006: a URL carrying a Microsoft auth response (${where}) is relayed by the bridge instead of booting the app`, async ({ page }) => {
      const response = 'code=not-a-real-code&state=not-a-real-state';
      await page.goto(where === 'query' ? `/?${response}` : `/#${response}`);

      // The bridge rejects a state it never issued — and says so, instead of a blank page.
      await expect(page.locator('body')).toContainText('Microsoft sign-in could not be completed');
      // The app did not boot: no router redirect to /login, no sign-in form.
      expect(new URL(page.url()).pathname).toBe('/');
      await expect(page.locator('input[type="email"]')).toHaveCount(0);
    });
  }

  test('SYS-SSO-10: without an auth response the app boots as usual', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('SYS-SSO-10: an activation link is not mistaken for an auth response', async ({ page }) => {
    // Only code/error AND state together mark an auth response; the app's own links must still boot.
    await page.goto('/activate?token=not-a-real-token');
    await expect(page.locator('body')).not.toContainText('Microsoft sign-in could not be completed');
    await expect(page.getByRole('heading', { name: 'Activate your account' })).toBeVisible();
  });
});

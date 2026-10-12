import { test, expect, type Page } from '@playwright/test';
import { CREDS } from './fixtures';

// E2E for the self-service password change in the user menu (SYS-AUTH-11 / SYS-AUTH-12, traced to
// SR-195 / VT-231). Uses its own freshly created member, never the seeded credentials other specs need.
// Validation and the API guards are covered in backend/tests/password-change.test.mjs.

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

test('SYS-AUTH-12 / SYS-AUTH-11 / VT-231 (SR-195): a user changes their own password from the user menu — a wrong current password is refused, then the new one signs in', async ({ page, request }) => {
  const admin = await request.post('/api/auth/login', { data: CREDS.admin });
  const adminToken = (await admin.json()).token;
  const email = `e2e.pw.${Date.now()}@test.local`;
  const created = await request.post('/api/users', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { name: 'Petra Password', email, password: 'original123', roleIds: [] },
  });
  expect(created.status()).toBe(201);

  await signIn(page, email, 'original123');
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByTestId('change-password-open').click();
  const dialog = page.getByTestId('change-password-dialog');
  await expect(dialog.getByRole('heading', { name: 'Change password' })).toBeVisible();

  // A wrong current password is refused inside the dialog.
  await dialog.getByLabel('Current password').fill('notmine123');
  await dialog.getByLabel('New password', { exact: true }).fill('brandnew456');
  await dialog.getByLabel('Confirm new password').fill('brandnew456');
  await dialog.getByTestId('change-password-submit').click();
  await expect(dialog.getByTestId('change-password-error')).toHaveText('The current password is incorrect');

  await dialog.getByLabel('Current password').fill('original123');
  await dialog.getByTestId('change-password-submit').click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  const oldLogin = await request.post('/api/auth/login', { data: { email, password: 'original123' } });
  expect(oldLogin.status(), 'the old password no longer signs in').toBe(401);
  const newLogin = await request.post('/api/auth/login', { data: { email, password: 'brandnew456' } });
  expect(newLogin.status(), 'the new password signs in').toBe(200);
});

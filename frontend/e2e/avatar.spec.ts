import { test, expect, type Page } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for user profile pictures (SYS-UI-10 / SYS-USR-06 / SYS-USR-07, traced to SR-201 / VT-238). Uses its
// own freshly created member, never the seeded accounts other specs need. Validation, impersonation and
// the audit masking are covered in backend/tests/avatar.test.mjs.

// A 1×1 PNG — any decodable image goes through the browser-side crop to a 128 px JPEG.
const PNG = {
  name: 'me.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
};

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

async function createMember(request: import('@playwright/test').APIRequestContext, name: string, email: string): Promise<void> {
  const admin = await request.post('/api/auth/login', { data: CREDS.admin });
  const created = await request.post('/api/users', {
    headers: { Authorization: `Bearer ${(await admin.json()).token}` },
    data: { name, email, password: 'secret123', roleIds: [] },
  });
  expect(created.status()).toBe(201);
}

test('SYS-UI-10 / SYS-USR-06 / VT-238 (SR-201): a user picks a profile picture in the user menu, it survives a reload, and Remove brings the initials back', async ({ page, request }) => {
  const email = `e2e.avatar.${Date.now()}@test.local`;
  await createMember(request, 'Pia Picture', email);
  await signIn(page, email, 'secret123');

  const menuButton = page.getByTestId('user-menu');
  await expect(menuButton).toContainText('PP'); // initials while there is no picture
  await menuButton.click();
  await page.getByTestId('avatar-input').setInputFiles(PNG);
  const barImage = menuButton.getByTestId('user-avatar-image');
  await expect(barImage).toBeVisible();
  await expect(barImage).toHaveAttribute('src', /^data:image\/jpeg;base64,/);

  await page.reload();
  await expect(page.getByTestId('user-menu').getByTestId('user-avatar-image')).toBeVisible();

  await page.getByTestId('user-menu').click();
  await page.getByTestId('avatar-remove').click();
  await expect(page.getByTestId('user-menu').getByTestId('user-avatar-image')).toHaveCount(0);
  await expect(page.getByTestId('user-menu')).toContainText('PP');
});

test('SYS-UI-10 / SYS-USR-07 / VT-238 (SR-201): an admin sets a user picture in the Users editor and the row shows it', async ({ page, request }) => {
  const email = `e2e.avatar.admin.${Date.now()}@test.local`;
  await createMember(request, 'Otto Other', email);
  await login(page, 'admin');
  await page.goto('/users');

  const row = page.locator('tr', { hasText: email });
  await expect(row.getByTestId('user-avatar-image')).toHaveCount(0);
  await row.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('user-avatar-input').setInputFiles(PNG);
  await expect(dialog.getByTestId('user-avatar-image')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(row.getByTestId('user-avatar-image')).toBeVisible();
});

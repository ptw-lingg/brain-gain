import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// Reference e2e spec (auth & access control). Frontend SYS-AUTH/SYS-AC requirements, traced to
// stakeholder SR-001..SR-005. This is the pattern fan-out specs follow.
test.describe('Authentication & access control', () => {
  test('SR-001/SR-002: admin signs in and lands on the dashboard', async ({ page }) => {
    await login(page, 'admin');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('SR-004: admin sees the full admin navigation', async ({ page }) => {
    await login(page, 'admin');
    const aside = page.locator('aside');
    for (const item of ['My Trainings', 'Trainings', 'Trainees', 'Job Roles', 'Users', 'Settings']) {
      await expect(aside).toContainText(item);
    }
  });

  test('SR-004: a member sees only their trainings — no admin navigation', async ({ page }) => {
    await login(page, 'member');
    const aside = page.locator('aside');
    await expect(aside).toContainText('My Trainings');
    await expect(aside).not.toContainText('Users');
    await expect(aside).not.toContainText('Settings');
  });

  test('SR-003: a member is redirected away from an admin-only route', async ({ page }) => {
    await login(page, 'member');
    await page.goto('/users');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('SR-001: invalid credentials are rejected and stay on /login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@braingain.app');
    await page.fill('input[type="password"]', 'definitely-wrong');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('SR-005: the session persists across a reload', async ({ page }) => {
    await login(page, 'admin');
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('aside')).toContainText('Users');
  });
});

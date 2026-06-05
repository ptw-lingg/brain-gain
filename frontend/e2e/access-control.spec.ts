import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2e access-control spec for the auth area (SYS-AC-04 router guard · SYS-AC-05 role-gated sidebar),
// tracing stakeholder SR-003 (admin-only editing, reliably enforced — not merely hidden) and
// SR-004 (three access levels, each shown only their appropriate capabilities).
//
// These cases are deliberately DISTINCT from auth.spec.ts, which already covers: admin full nav,
// the member sidebar (no Users/Settings), the member bounce off /users, invalid credentials, and
// session persistence. Here we focus on the TRAINER level and the member bounce off /roles & /settings.
test.describe('Access control — trainer & member route guards', () => {
  // ── SYS-AC-05 / SR-004: a trainer sees Trainings + Trainees, but NOT the admin-only items ──
  test('SR-004 / SYS-AC-05: a trainer sees Trainings & Trainees but not Job Roles / Users / Settings', async ({ page }) => {
    await login(page, 'trainer');
    const aside = page.locator('aside');

    // Trainer-level capabilities are present...
    await expect(aside).toContainText('My Trainings');
    await expect(aside).toContainText('Trainings');
    await expect(aside).toContainText('Trainees');

    // ...but the admin-only navigation is absent (defense-in-depth: the sidebar is role-gated).
    await expect(aside).not.toContainText('Job Roles');
    await expect(aside).not.toContainText('Users');
    await expect(aside).not.toContainText('Settings');
    await expect(aside).not.toContainText('Requirements');
  });

  // ── SYS-AC-04 / SR-003: the trainer-or-admin routes are reachable by a trainer ──
  test('SR-004 / SYS-AC-04: a trainer can navigate to /trainings and /trainees', async ({ page }) => {
    await login(page, 'trainer');

    await page.goto('/trainings');
    await expect(page).toHaveURL(/\/trainings/);

    await page.goto('/trainees');
    await expect(page).toHaveURL(/\/trainees/);
  });

  // ── SYS-AC-04 / SR-003: a trainer is still bounced off the admin-only routes ──
  test('SR-003 / SYS-AC-04: a trainer is redirected away from admin-only routes (/users, /settings, /roles)', async ({ page }) => {
    await login(page, 'trainer');

    for (const route of ['/users', '/settings', '/roles']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });

  // ── SYS-AC-04 / SR-003: a member is bounced off /roles (not covered in auth.spec.ts) ──
  test('SR-003 / SYS-AC-04: a member is redirected away from /roles', async ({ page }) => {
    await login(page, 'member');
    await page.goto('/roles');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  // ── SYS-AC-04 / SR-003: a member is bounced off /settings (not covered in auth.spec.ts) ──
  test('SR-003 / SYS-AC-04: a member is redirected away from /settings', async ({ page }) => {
    await login(page, 'member');
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  // ── SYS-AC-04 / SR-003: a member is bounced off the trainer-or-admin /trainees route ──
  test('SR-003 / SYS-AC-04: a member is redirected away from /trainees (trainer-or-admin only)', async ({ page }) => {
    await login(page, 'member');
    await page.goto('/trainees');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('SYS-AUTH-05 / SR-005: the JWT is stored client-side and a 401 clears the session and bounces to /login', async ({ page }) => {
    await login(page, 'admin');
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token, 'the JWT is persisted in localStorage').toBeTruthy();
    // Corrupt the stored token, then hit an authenticated view: the axios 401 interceptor (and the
    // router guard's fetchMe) must clear the session and redirect to /login.
    await page.evaluate(() => localStorage.setItem('token', 'tampered.invalid.token'));
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login/);
  });
});

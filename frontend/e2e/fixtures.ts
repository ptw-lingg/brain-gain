import { type Page } from '@playwright/test';

// Seed credentials created by backend/src/seed.ts on a fresh data dir (see global-setup).
//   admin   → full admin
//   trainer → trainer (owns trainings)
//   member  → plain member, assigned 2 trainings via the "Lab Technician" role
export const CREDS = {
  admin: { email: 'admin@braingain.app', password: 'admin123' },
  trainer: { email: 'trainer@braingain.app', password: 'trainer123' },
  member: { email: 'user@braingain.app', password: 'user123' },
} as const;

export type Role = keyof typeof CREDS;

/** Log in through the real login form and wait for the dashboard. Each test gets a fresh context. */
export async function login(page: Page, role: Role): Promise<void> {
  const { email, password } = CREDS[role];
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');
}

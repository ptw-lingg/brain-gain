import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2e smoke for SR-103 "All entities editable via UI" (system reqs SYS-DATA-01 / SYS-ARCH-01),
// validation VT-103. Confirms an admin can reach the live editor for every managed entity:
// Users, Job Roles, Trainings and Settings. The deeper persistence/round-trip behaviour is
// covered by backend/tests/data-arch-nfr.test.mjs; here we only prove the editors are reachable
// through the real UI. Follows the pattern of auth.spec.ts (login() + page.goto).
test.describe('Data/Arch/NFR — all entities editable via UI (SR-103 / VT-103)', () => {
  test('SYS-DATA-02 / VT-103: admin can open the Users editor (drawer)', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    // The seeded admin row is listed; opening it reveals the edit drawer with the field set.
    await page.getByRole('button', { name: 'Add User' }).click();
    await expect(page.getByRole('heading', { name: 'New user' })).toBeVisible();
    // Editable fields exist: email + password inputs and the admin/trainer toggle labels.
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByText('Admin', { exact: true })).toBeVisible();
    await expect(page.getByText('Trainer', { exact: true })).toBeVisible();
  });

  test('SYS-DATA-02 / VT-103: admin can open an existing user to edit it', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');
    // Clicking a user row opens the "Edit user" drawer (the JSON record is editable in the UI).
    await page.getByText('user@braingain.app').click();
    await expect(page.getByRole('heading', { name: 'Edit user' })).toBeVisible();
    // exact: the drawer label is "Job roles"; without it, getByText also matches the sidebar "Job Roles".
    await expect(page.getByText('Job roles', { exact: true })).toBeVisible();
  });

  test('SYS-DATA-03 / VT-103: admin can open the Job Role editor', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/roles');
    await expect(page.getByRole('heading', { name: 'Job Roles' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Role' }).click();
    await expect(page.getByRole('heading', { name: 'New role' })).toBeVisible();
    // The role editor offers the training multi-select (RoleForm) — entities are linkable in the UI.
    await expect(page.getByText('Laboratory Safety Basics')).toBeVisible();
  });

  test('SYS-DATA-04 / VT-103: admin can open the Training editor', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainings');
    await expect(page.getByRole('heading', { name: 'Trainings' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Training' }).click();
    await expect(page.getByRole('heading', { name: 'New training' })).toBeVisible();
  });

  test('SYS-DATA-04 / VT-103: admin can expand a seeded training to edit it', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainings');
    // Clicking a training row expands its inline editor (TrainingForm) — fully editable in the UI.
    await page.getByText('Laboratory Safety Basics').click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('SYS-DATA-06 / VT-103: admin can reach the Settings editors (threshold + SSO)', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    // Both editable cards are present: the global pass threshold and the Entra SSO config.
    await expect(page.getByRole('heading', { name: 'Global pass threshold' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Microsoft Entra ID (SSO)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save SSO settings' })).toBeVisible();
  });
});

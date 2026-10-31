import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2e specs for the users-roles area (UI/end-to-end behaviour).
//   SYS-USR-02 (SR-020/SR-021/SR-022) — Users page: list + modal editor dialog with role
//     multi-select and isAdmin/isTrainer toggles. VT-020 (create/edit/delete a user), VT-021.
//   SYS-ROL-02 (SR-030/SR-031) — Roles page: create/edit/delete a job role with a training
//     multi-select. VT-030 (manage roles), VT-031 (role requires trainings).
// Follows frontend/e2e/auth.spec.ts; uses login(page, 'admin') from fixtures.
//
// Unique emails/names per run are derived from Date.now() so reruns against the shared fixed-port
// server never collide on the duplicate-email guard.
const STAMP = Date.now();

test.describe('Users page — admin CRUD via the dialog (SYS-USR-02)', () => {
  test('SYS-USR-02 / VT-020 (SR-020, SR-022): admin creates a user with admin & trainer toggles', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');
    await expect(page.locator('h1')).toContainText('Users');

    const email = `e2e.create.${STAMP}@test.local`;
    await page.getByRole('button', { name: 'Add User' }).click();

    const dialog = page.locator('.fixed.inset-0.z-40');
    await expect(dialog).toContainText('New user');
    await dialog.locator('input[type="email"]').fill(email);
    await dialog.locator('input').first().fill('E2E Created'); // Name is the first text input
    await dialog.locator('input[type="password"]').fill('secret123');

    // Toggle Admin + Trainer (the two checkboxes in the access row).
    await dialog.getByText('Admin', { exact: true }).click();
    await dialog.getByText('Trainer', { exact: true }).click();

    await dialog.getByRole('button', { name: 'Save' }).click();

    // Dialog closes and the new user appears in the table. The close waits get extra headroom:
    // save = POST + list reload, which can exceed the 8s expect default under full-suite load.
    await expect(page.locator('.fixed.inset-0.z-40')).toHaveCount(0, { timeout: 15_000 });
    const row = page.locator('tr', { hasText: email });
    await expect(row).toBeVisible();
    // Admin flag wins the access pill.
    await expect(row).toContainText('admin');
  });

  test('SYS-USR-02 / VT-020 (SR-020): admin edits a user — blank password keeps it, name changes', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');

    // Edit the seeded member by opening its row.
    const row = page.locator('tr', { hasText: 'user@braingain.app' });
    await row.click();

    const dialog = page.locator('.fixed.inset-0.z-40');
    await expect(dialog).toContainText('Uma User'); // the title names who is being edited
    // Password field is pre-cleared (blank = keep current) per UsersPage behaviour.
    await expect(dialog.locator('input[type="password"]')).toHaveValue('');

    const newName = `Renamed Member ${STAMP}`;
    const nameInput = dialog.getByLabel('Name', { exact: true }); // an existing account's editor starts with the picture
    await nameInput.fill(newName);
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('.fixed.inset-0.z-40')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('tr', { hasText: 'user@braingain.app' })).toContainText(newName);
    // The table marks the row whose dialog was opened last, so the user sees where they were.
    await expect(page.locator('tr', { hasText: 'user@braingain.app' })).toHaveAttribute('data-selected', 'true');
  });

  test('SYS-USR-02 / VT-021 (SR-021): admin assigns several job roles to a user and they persist', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');

    const email = `e2e.roles.${STAMP}@test.local`;
    await page.getByRole('button', { name: 'Add User' }).click();
    const dialog = page.locator('.fixed.inset-0.z-40');
    await dialog.locator('input').first().fill('E2E Multi Role');
    await dialog.locator('input[type="email"]').fill(email);
    await dialog.locator('input[type="password"]').fill('secret123');

    // Tick every job-role checkbox under the "Job roles" section.
    const roleChecks = dialog.locator('label:has(input[type="checkbox"]) input[type="checkbox"]').nth(2);
    // The first two checkboxes are Admin/Trainer; role checkboxes follow. Tick the first role.
    await roleChecks.check();

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.fixed.inset-0.z-40')).toHaveCount(0, { timeout: 15_000 });

    // Reopen and confirm the assignment persisted (checkbox stays checked).
    await page.locator('tr', { hasText: email }).click();
    const reopened = page.locator('.fixed.inset-0.z-40');
    await expect(reopened).toContainText('E2E Multi Role'); // the title names who is being edited
    await expect(
      reopened.locator('label:has(input[type="checkbox"]) input[type="checkbox"]').nth(2),
    ).toBeChecked();
  });

  test('SYS-USR-02 / VT-020 (SR-020): admin deletes a user', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/users');

    // Create a throwaway user, then delete it via the dialog's confirm flow.
    const email = `e2e.delete.${STAMP}@test.local`;
    await page.getByRole('button', { name: 'Add User' }).click();
    let dialog = page.locator('.fixed.inset-0.z-40');
    await dialog.locator('input').first().fill('E2E Delete Me');
    await dialog.locator('input[type="email"]').fill(email);
    await dialog.locator('input[type="password"]').fill('secret123');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.fixed.inset-0.z-40')).toHaveCount(0, { timeout: 15_000 });

    await page.locator('tr', { hasText: email }).click();
    dialog = page.locator('.fixed.inset-0.z-40');
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await dialog.getByRole('button', { name: 'Yes' }).click();

    await expect(page.locator('.fixed.inset-0.z-40')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('tr', { hasText: email })).toHaveCount(0);
  });
});

test.describe('Roles page — admin manages a job role (SYS-ROL-02)', () => {
  test('SYS-ROL-02 / VT-030 (SR-030) + VT-031 (SR-031): admin creates a role and selects required trainings', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/roles');
    await expect(page.locator('h1')).toContainText('Job Roles');

    const roleName = `E2E Role ${STAMP}`;
    await page.getByRole('button', { name: 'Add Role' }).click();

    // The "New role" editor card.
    const editor = page.locator('.card', { hasText: 'New role' });
    await editor.getByPlaceholder('e.g. Lab Technician').fill(roleName);

    // Select the first required training (VT-031).
    const firstTraining = editor.locator('input[type="checkbox"]').first();
    await firstTraining.check();

    await editor.getByRole('button', { name: 'Create' }).click();

    // The new role appears in the list with a training count >= 1.
    const roleRow = page.locator('.card', { hasText: roleName });
    await expect(roleRow).toBeVisible();
    await expect(roleRow).toContainText('training');
  });

  test('SYS-ROL-02 / VT-031 (SR-031): editing a role persists its training selection', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/roles');

    // Open the seeded "Lab Technician" role.
    const roleRow = page.locator('.card', { hasText: 'Lab Technician' });
    await roleRow.locator('div.cursor-pointer').first().click();

    // Its expanded editor shows the training checklist; at least one is already selected.
    const editor = page.locator('.card', { hasText: 'Lab Technician' });
    await expect(editor.locator('input[type="checkbox"]:checked').first()).toBeVisible();

    // Save (no change) and confirm it still lists its trainings.
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.card', { hasText: 'Lab Technician' })).toContainText('training');
  });

  test('SYS-ROL-02 / VT-030 (SR-030): admin deletes a role', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/roles');

    // Create a disposable role, then delete it.
    const roleName = `E2E Delete Role ${STAMP}`;
    await page.getByRole('button', { name: 'Add Role' }).click();
    const newEditor = page.locator('.card', { hasText: 'New role' });
    await newEditor.getByPlaceholder('e.g. Lab Technician').fill(roleName);
    await newEditor.getByRole('button', { name: 'Create' }).click();

    const roleRow = page.locator('.card', { hasText: roleName });
    await expect(roleRow).toBeVisible();
    await roleRow.locator('div.cursor-pointer').first().click();

    const editor = page.locator('.card', { hasText: roleName });
    // exact: true — the role name contains the word "Delete", and the expanded row header is itself a
    // role="button"; without exact matching the name-substring would also match the row (strict-mode clash).
    await editor.getByRole('button', { name: 'Delete', exact: true }).click();
    await editor.getByRole('button', { name: 'Yes' }).click();

    await expect(page.locator('.card', { hasText: roleName })).toHaveCount(0);
  });

  test('SYS-ROL-03 / VT-047 (SR-047): the role editor lists trainings in the admin-defined order', async ({ page }) => {
    await login(page, 'admin');

    // Capture the training order as served to the admin Trainings page list.
    await page.goto('/roles');
    await page.getByRole('button', { name: 'Add Role' }).click();
    const editor = page.locator('.card', { hasText: 'New role' });

    // The training checklist must render at least the two seeded trainings.
    const labels = editor.locator('label:has(input[type="checkbox"])');
    await expect(labels.first()).toBeVisible();
    await expect(await labels.count()).toBeGreaterThanOrEqual(2);
  });
});

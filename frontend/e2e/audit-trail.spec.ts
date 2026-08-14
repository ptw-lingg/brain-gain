import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for the Audit trail admin page (SYS-AUD-08, traced to SR-160 / VT-171): an admin sees new
// entries appear, filters them, expands a row to read the field-level diff, and exports the filtered
// trail as CSV; non-admins have no navigation entry and the route bounces them to the dashboard.
// Entry content, redaction, backup/restore survival and the API's access control are covered
// API-side in backend/tests/audit-trail.test.mjs.

test.describe('Audit trail — admin page', () => {
  test('SYS-AUD-08 / SR-160 / VT-171: /audit is admin-only — a trainer is bounced and has no nav entry', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/audit');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('aside')).not.toContainText('Audit trail');
  });

  test('SYS-AUD-08 / SR-160 / VT-171: an admin sees a fresh entry, filters to it, and expands its field diff', async ({ page }) => {
    await login(page, 'admin');

    // Produce an audited change with a diff: create a job role, then rename it.
    await page.goto('/roles');
    const stamp = Date.now() % 100000;
    const roleName = `Audit E2E Role ${stamp}`;
    const renamed = `Audit E2E Renamed ${stamp}`;
    await page.getByRole('button', { name: 'Add Role' }).click();
    const newEditor = page.locator('.card', { hasText: 'New role' });
    await newEditor.getByPlaceholder('e.g. Lab Technician').fill(roleName);
    await newEditor.getByRole('button', { name: 'Create' }).click();

    const roleRow = page.locator('.card', { hasText: roleName });
    await expect(roleRow).toBeVisible();
    await roleRow.locator('div.cursor-pointer').first().click();
    const editor = page.locator('.card', { hasText: roleName });
    await editor.getByPlaceholder('e.g. Lab Technician').fill(renamed);
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.card', { hasText: renamed }).first()).toBeVisible();

    // The audit page lists both actions, newest first.
    await page.locator('aside').getByRole('link', { name: 'Audit trail', exact: true }).click();
    await expect(page).toHaveURL(/\/audit/);
    await expect(page.getByRole('heading', { name: 'Audit trail' })).toBeVisible();

    // Filter down to the update and expand its diff.
    await page.getByTestId('audit-filter-entity').selectOption('role');
    await page.getByTestId('audit-filter-action').selectOption('update');
    await page.getByTestId('audit-filter-text').fill(renamed);
    const entryRow = page.getByTestId('audit-row-update').first();
    await expect(entryRow).toBeVisible();
    await expect(entryRow).toContainText('admin@braingain.app');
    await expect(entryRow).toContainText(renamed);
    // The Time column shows the wall-clock time of the entry, not just the day.
    await expect(entryRow).toContainText(/\d{1,2}:\d{2}:\d{2}/);

    await entryRow.getByRole('button').click();
    const changes = page.getByTestId('audit-changes');
    await expect(changes).toBeVisible();
    await expect(changes).toContainText('name');
    await expect(changes).toContainText(roleName); // before
    await expect(changes).toContainText(renamed); // after
  });

  test('SYS-AUD-08 / SR-160 / VT-171: Export CSV downloads the filtered trail as a CSV file', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/audit');
    await expect(page.getByTestId('audit-row-login').first()).toBeVisible(); // signing in above created entries

    await page.getByTestId('audit-filter-action').selectOption('login');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('audit-export').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^braingain-audit-.*\.csv$/);
  });
});

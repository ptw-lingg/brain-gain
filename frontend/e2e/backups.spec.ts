import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for the Backups admin page (SYS-BAK-09, traced to SR-140..SR-145 / VT-140..VT-145): an admin
// creates a backup and sees it listed, downloads one and all, uploads an archive, restores with the
// confirm step, and deletes. The archive contents, validation and restore atomicity are covered
// API-side in backend/tests/backup.test.mjs.
//
// These specs run in order against the shared server: the first creates the backup the later ones use.
// NOTE: the restore spec deliberately restores a snapshot taken earlier *within this file*, so it only
// rolls back changes this file made — it must never restore an archive predating the other spec files.

test.describe('Backups — admin data protection', () => {
  test('SYS-BAK-09 / SR-145 / VT-145: /backups is admin-only — a trainer is bounced to the dashboard', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/backups');
    await expect(page).toHaveURL(/\/dashboard/);
    // The sidebar does not offer it either.
    await expect(page.locator('aside')).not.toContainText('Backups');
  });

  test('SYS-BAK-09 / SYS-BAK-01 / SR-140 / VT-140: an admin creates a backup and it appears in the list with size and contents', async ({ page }) => {
    await login(page, 'admin');
    await page.locator('aside').getByRole('link', { name: 'Backups', exact: true }).click();
    await expect(page).toHaveURL(/\/backups/);
    await expect(page.getByRole('heading', { name: 'Backups' })).toBeVisible();
    // The page states what a backup holds and that the TLS key is not in it.
    await expect(page.getByText(/does not contain the TLS private key/)).toBeVisible();

    await page.getByRole('button', { name: 'Create backup' }).click();
    const row = page.locator('tbody tr').filter({ hasText: /braingain-backup-.*\.zip/ }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('manual');
    await expect(row).toContainText(/\d+(\.\d+)?\s?(B|KB|MB)/); // a real size
    await expect(row).toContainText(/users/); // contents summary
  });

  test('SYS-BAK-03 / SR-141 / VT-141: the admin downloads a single archive under its server-issued name', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backups');
    const row = page.locator('tbody tr').first();
    await expect(row).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^braingain-backup-.*\.zip$/);
  });

  test('SYS-BAK-04 / SR-142 / VT-142: Download all yields one bundled archive', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backups');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download all' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^braingain-backups-.*\.zip$/);
  });

  test('SYS-BAK-05 / SR-143 / VT-143: uploading a non-backup file is rejected with a message and adds no row', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backups');
    // Wait for the list to load before counting — count() does not wait, so an in-flight fetch
    // would read 0 rows here and corrupt the row-count assertion below.
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const before = await page.locator('tbody tr').count();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'not-a-backup.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('definitely not a zip archive'),
    });
    // The server refuses it and the UI surfaces the reason; the list is unchanged.
    await expect(page.getByText(/Not a readable ZIP archive|Could not upload the backup/)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(before);
  });

  test('SYS-BAK-05 / SR-143 / VT-143: the admin uploads a real archive and it is listed as uploaded', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backups');
    // Take a genuine archive by downloading the newest backup, then upload it back.
    const row = page.locator('tbody tr').first();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.getByRole('button', { name: 'Download' }).click(),
    ]);
    const path = await download.path();

    await page.locator('input[type="file"]').setInputFiles(path!);
    const uploaded = page.locator('tbody tr').filter({ hasText: 'uploaded' }).first();
    await expect(uploaded).toBeVisible();
  });

  test('SYS-BAK-06 / SR-144 / VT-144: restore asks for confirmation, then reports success and records a pre-restore backup', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backups');
    const row = page.locator('tbody tr').filter({ hasText: 'manual' }).first();
    await expect(row).toBeVisible();

    // Restore is destructive — it must ask first, and cancelling must do nothing.
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(row.getByText('Replace all current data with this backup?')).toBeVisible();
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row.getByText('Replace all current data with this backup?')).toHaveCount(0);

    // Confirming performs the restore.
    await row.getByRole('button', { name: 'Restore' }).click();
    await row.getByRole('button', { name: 'Yes, restore' }).click();
    await expect(page.getByText('Data restored from the backup')).toBeVisible({ timeout: 30_000 });

    // The server's automatic undo point is now listed.
    await expect(page.locator('tbody tr').filter({ hasText: 'pre-restore' }).first()).toBeVisible();
  });

  test('SYS-BAK-02 / SR-144 / VT-145: deleting a backup asks for confirmation and removes the row', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backups');
    // Wait for the list to load before counting — count() does not wait, so an in-flight fetch
    // would read 0 rows here and corrupt the row-count assertion below.
    await expect(page.locator('tbody tr').first()).toBeVisible();
    const before = await page.locator('tbody tr').count();
    const row = page.locator('tbody tr').first();
    const name = (await row.locator('td').first().textContent())?.trim();

    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete this backup?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, delete' }).click();

    await expect(page.locator('tbody tr')).toHaveCount(before - 1);
    if (name) await expect(page.locator('tbody tr').filter({ hasText: name })).toHaveCount(0);
  });
});

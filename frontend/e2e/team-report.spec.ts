import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for the head's Training Status Report (SYS-ORG-08), traced to SR-129.
// On a fresh seed the migration makes the admin the head of the root unit, so the admin's "My Team"
// has members and the report can be generated. The report must PREVIEW inline (pdf.js page images)
// before the download is reachable — view-before-download, like the controlled documents.
test.describe('My Team — training status report', () => {
  test('SYS-ORG-08 / VT-131 (SR-129): a head previews the report inline before the gated download', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/my-team');

    // Open the report; it renders to inline page images.
    await page.getByRole('button', { name: /Training status report/ }).click();
    await expect(page.locator('img[data-pdf-page]').first()).toBeVisible({ timeout: 30_000 });

    // The download is only reachable from the open preview (view-before-download).
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
  });

  test('SYS-ORG-08 (SR-004): a plain member does not see My Team', async ({ page }) => {
    await login(page, 'member');
    await page.goto('/my-team');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

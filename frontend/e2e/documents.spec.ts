import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// Controlled-document generation on the Requirements tab (DMS transfer), for the medical-device QMS.
// Covers: SR-120, SR-121 / SYS-DOC-01, SYS-DOC-02, SYS-DOC-03, SYS-DOC-04 / VT-120, VT-121.
// The four documents (SRS, RTM, SVVR, DRR) are generated as PDFs, previewed in-app, then downloaded.
test.describe('Controlled documents for the DMS (Requirements tab)', () => {
  test('SR-121 / SYS-DOC-02: the Requirements tab shows the coverage summary and per-item Tested by', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    await expect(page.getByRole('heading', { name: 'Requirements' })).toBeVisible();
    await expect(page.getByText(/ids covered/)).toBeVisible();
    // Selecting a requirement that has tests shows its "Tested by" trace.
    await page.getByRole('button', { name: /SYS-AUTH-01/ }).first().click();
    await expect(page.getByText('Tested by')).toBeVisible();
  });

  test('SR-120 / SYS-DOC-03 / SYS-DOC-04 / VT-120: each controlled document previews as a PDF before download is allowed', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    for (const abbr of ['SRS', 'RTM', 'SVVR', 'DRR']) {
      await page.getByRole('button', { name: abbr, exact: true }).click();
      const frame = page.locator('iframe[title="Document preview"]');
      await expect(frame).toBeVisible({ timeout: 20000 }); // PDF rendered to a blob URL (pdfmake)
      expect(await frame.getAttribute('src')).toMatch(/^blob:/);
      await expect(page.getByRole('button', { name: /Download PDF/i })).toBeEnabled();
      await page.getByTitle('Close').click();
      await expect(frame).toHaveCount(0);
    }
  });

  test('SR-120 / VT-120: downloading a previewed document yields a named .pdf for the DMS', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    await page.getByRole('button', { name: 'SVVR', exact: true }).click();
    await expect(page.locator('iframe[title="Document preview"]')).toBeVisible({ timeout: 20000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download PDF/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^SVVR-BRAINGAIN-001-Rev.*\.pdf$/);
  });
});

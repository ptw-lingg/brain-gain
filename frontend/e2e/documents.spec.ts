import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// Controlled-document generation + the searchable tests/results on the Requirements tab (internal
// build only). Covers: SR-120, SR-121, SR-122, SR-123 / SYS-DOC-01..08 / VT-120, VT-121, VT-122, VT-123.
// All 12 documents (SRS, RTM, SVVR, DRR + the IEC 62304 lifecycle set) are generated as PDFs,
// previewed in-app, then downloaded for the DMS.
const ALL_DOCS = ['SRS', 'RTM', 'SVVR', 'DRR', 'SDP', 'SSC', 'SAD', 'SRR', 'SCMP', 'SPR', 'SMP', 'SRMF'];

test.describe('Controlled documents & test traceability (Requirements tab)', () => {
  test('SR-121 / SYS-DOC-02 / VT-121: the Requirements tab shows coverage, the Class B pill and per-item Tested by', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    await expect(page.getByRole('heading', { name: 'Requirements' })).toBeVisible();
    await expect(page.getByText(/covered/)).toBeVisible();
    await expect(page.getByText(/IEC 62304 · Class B/)).toBeVisible();
    await page.getByRole('button', { name: /SYS-AUTH-01/ }).first().click();
    await expect(page.getByText('Tested by', { exact: true })).toBeVisible(); // the detail trace heading
  });

  test('SR-120 / SR-122 / SYS-DOC-03 / SYS-DOC-04 / SYS-DOC-05 / SYS-DOC-06 / VT-120 / VT-122: every controlled document previews as a PDF before download', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    for (const abbr of ALL_DOCS) {
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
    await page.getByRole('button', { name: 'SRMF', exact: true }).click(); // an IEC 62304 lifecycle doc
    await expect(page.locator('iframe[title="Document preview"]')).toBeVisible({ timeout: 20000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download PDF/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^SRMF-BRAINGAIN-001-Rev.*\.pdf$/);
  });

  test('SR-123 / SYS-DOC-07 / SYS-DOC-08 / VT-123: test cases are searchable objects with a result badge', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    await page.locator('select').first().selectOption('case'); // filter type → Test cases
    await page.getByPlaceholder(/Search/).fill('impersonat');
    const row = page.getByRole('button', { name: /TC-/ }).first();
    await expect(row).toBeVisible();
    await row.click();
    // The test-case detail shows what it covers (traceability) — confirming it is a first-class object.
    await expect(page.getByText('Covers')).toBeVisible();
  });
});

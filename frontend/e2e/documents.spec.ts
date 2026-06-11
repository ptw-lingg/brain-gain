import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// Controlled-document generation + the searchable tests/results on the Requirements tab (internal
// build only). Covers: SR-120, SR-121, SR-122, SR-123 / SYS-DOC-01..08 / VT-120, VT-121, VT-122, VT-123.
// Documents render INLINE (pdf.js → page images) — the test asserts a page actually rendered, not
// just that a blob URL exists — then download for the DMS.
const ALL_DOCS = ['SRS', 'RTM', 'SVVR', 'DRR', 'SDP', 'SSC', 'SAD', 'SRR', 'SCMP', 'SPR', 'SMP', 'SRMF'];

test.describe('Controlled documents & test traceability (Requirements tab)', () => {
  test('SR-121 / SYS-DOC-02 / VT-121: the tab shows coverage, the Class B pill, the test-run date and per-item Tested by', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    await expect(page.getByRole('heading', { name: 'Requirements' })).toBeVisible();
    await expect(page.getByText(/covered/)).toBeVisible();
    await expect(page.getByText(/IEC 62304 · Class B/)).toBeVisible();
    await expect(page.getByText(/tests (not run|\d{4}-\d{2}-\d{2})/)).toBeVisible(); // run-date pill
    await page.getByRole('button', { name: /SYS-AUTH-01/ }).first().click();
    await expect(page.getByText('Tested by', { exact: true })).toBeVisible();
  });

  test('SR-120 / SR-122 / SYS-DOC-03 / SYS-DOC-04 / SYS-DOC-05 / SYS-DOC-06 / VT-120 / VT-122: every document renders inline as page images before download', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    for (const abbr of ALL_DOCS) {
      await page.getByRole('button', { name: abbr, exact: true }).click();
      const firstPage = page.locator('img[data-pdf-page]').first();
      await expect(firstPage).toBeVisible({ timeout: 30000 }); // pdf.js rendered a page (no native viewer)
      await expect
        .poll(async () => firstPage.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10000 })
        .toBeGreaterThan(0); // a real raster page, not a blank/failed embed
      await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
      await page.getByTitle('Close').click();
      await expect(page.locator('img[data-pdf-page]')).toHaveCount(0);
    }
  });

  test('SR-120 / VT-120: downloading a previewed document yields a named .pdf for the DMS', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    await page.getByRole('button', { name: 'SRMF', exact: true }).click();
    await expect(page.locator('img[data-pdf-page]').first()).toBeVisible({ timeout: 30000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^SRMF-BRAINGAIN-001-Rev.*\.pdf$/);
  });

  test('SR-123 / SYS-DOC-07 / SYS-DOC-08 / VT-123: test cases are searchable objects with a result badge', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/requirements');
    await page.locator('main select').first().selectOption('case'); // filter type → Test cases (scope to the page, not the sidebar language switcher)
    await page.getByPlaceholder(/Search/).fill('impersonat');
    const row = page.getByRole('button', { name: /TC-/ }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText('Covers')).toBeVisible(); // test-case detail (first-class object)
  });
});

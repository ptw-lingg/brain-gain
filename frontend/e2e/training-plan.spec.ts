import { test, expect } from '@playwright/test';
import { login } from './fixtures';

// E2E for the Training Plan controlled document (SYS-DOC-10), traced to SR-130 and validated by
// VT-132. The admin generates a Training Plan PDF (trainings; job roles → assigned trainings; members
// → assigned roles) which must PREVIEW inline (pdf.js page images) before the download is reachable —
// view-before-download, transferred to the DMS afterwards.
//
// Implementation under test:
//   frontend/src/utils/trainingPlan.ts     (buildTrainingPlan — the document definition)
//   frontend/src/pages/TrainingsPage.vue    (openTrainingPlan / downloadTrainingPlan preview modal)
test.describe('Trainings — training plan document', () => {
  test('SYS-DOC-10 / VT-132 / SR-130: admin previews the training plan inline before the gated download', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/trainings');

    // Open the training plan; it renders to inline page images first.
    await page.getByRole('button', { name: 'Training plan' }).click();
    await expect(page.locator('img[data-pdf-page]').first()).toBeVisible({ timeout: 30_000 });

    // The download (transfer to DMS) is reachable only from the open preview (view-before-download).
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
  });

  test('SYS-DOC-10 (SR-004): a trainer who heads no unit does not see the training plan action', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');
    // The trainings list is visible to a trainer, but the training plan (admin/head only) is not.
    await expect(page.getByRole('button', { name: 'Add Training' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Training plan' })).toHaveCount(0);
  });
});

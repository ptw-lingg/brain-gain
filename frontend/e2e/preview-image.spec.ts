import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';
import { buildScorm12 } from '../../backend/tests/helpers/scormFixture.mjs';

// E2E for the training card's preview image (SYS-TRN-20, traced to SR-185 / VT-219): the trainer
// uploads a cover in the editor's Basics section, saving applies it WITHOUT a publish step (master
// data, not content), the learner's card renders it as its cover, and removing it brings the tinted
// placeholder back. Validation, byte cleanup and the learner payload are covered API-side in
// backend/tests/training-preview-image.test.mjs.
//
// The tests in this file run in order: upload → learner sees it → remove → learner sees the fallback.

const TRAINING = 'Laboratory Safety Basics';
// A real 1×1 PNG: the editor decodes and re-encodes the picked image before uploading it.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** The learner's card for the seeded training, located by its title. */
const cardFor = (page: import('@playwright/test').Page, title: string) =>
  page.locator('[data-testid="training-card-cover"]').locator('..').filter({ has: page.getByRole('heading', { name: title }) });

test.describe('Trainings — card preview image end to end', () => {
  test('SYS-TRN-20 / SR-185 / VT-219: a trainer uploads a preview image in the Basics section and saving needs no publish step', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(TRAINING).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Basics is open on arrival; the image block starts with the placeholder glyph, no image.
    const thumb = dialog.getByTestId('preview-image-thumb');
    await expect(thumb.locator('img')).toHaveCount(0);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dialog.getByTestId('preview-image-upload').click(),
    ]);
    await chooser.setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG_1PX });
    // The scaled image is uploaded right away and shown at the card's aspect ratio.
    await expect(thumb.locator('img')).toBeVisible();
    await expect(dialog.getByTestId('preview-image-upload')).toHaveText(/Replace image/);
    await expect(dialog.getByTestId('preview-image-remove')).toBeVisible();

    // Master data: the save applies the cover immediately, without a publish step. (The SEEDED quiz
    // predates the question-type field, so the first save of this training normalizes it into a
    // draft and offers the publish dialog for THAT — unrelated to the image; keep it as a draft.)
    // Other specs may have published this training before us, so the version is compared, not fixed.
    const token = await page.evaluate(() => localStorage.getItem('token'));
    const fetchTraining = async () => {
      const list = await page.request.get('/api/trainings', { headers: { Authorization: `Bearer ${token}` } });
      expect(list.ok()).toBe(true);
      return (await list.json()).find((t: { name: { en?: string } }) => t.name.en === TRAINING);
    };
    const before = await fetchTraining();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Training updated')).toBeVisible();
    // The editor closes only after the list reloaded; the publish dialog (if any) opens in that
    // same tick — so wait for the editor to be gone before deciding whether one is there.
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    const publish = page.getByTestId('publish-update-dialog');
    if (await publish.count()) await publish.getByTestId('publish-update-skip').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The cover is live on the PUBLISHED record right away: version unchanged, image present.
    const saved = await fetchTraining();
    expect(saved.version).toBe(before.version);
    expect(saved.previewImage?.type).toBe('image/jpeg');

    // Persistence: reopen — the thumbnail is back.
    await page.reload();
    await page.getByText(TRAINING).click();
    await expect(page.getByRole('dialog').getByTestId('preview-image-thumb').locator('img')).toBeVisible();
  });

  test('SYS-TRN-20 / SR-185 / VT-219: the learner\'s card shows the image as its cover; cards without one keep the tinted placeholder', async ({ page }) => {
    await login(page, 'member');
    const withImage = cardFor(page, TRAINING);
    await expect(withImage).toHaveCount(1);
    const img = withImage.getByTestId('training-card-image');
    await expect(img).toBeVisible();
    // The bytes were fetched with the Authorization header and handed to the image as a blob: URL.
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { message: 'the cover decoded' })
      .toBeGreaterThan(0);
    // The due status sits in the cover's corner; the content below is unchanged.
    await expect(withImage.getByTestId('training-card-cover')).toContainText(/Due|Overdue|Next due|Updated/);
    await expect(withImage.getByRole('button', { name: /Start/ })).toBeVisible();

    // Every other card keeps the same cover band, showing the placeholder instead of a picture.
    const covers = page.getByTestId('training-card-cover');
    expect(await covers.count()).toBeGreaterThan(1);
    expect(await page.getByTestId('training-card-image').count()).toBe(1);
    await page.screenshot({ path: 'test-results/preview-image-dashboard.png', fullPage: true });
  });

  test('SYS-TRN-20 / SR-185 / VT-219: removing the image brings the placeholder back on the learner\'s card', async ({ page }) => {
    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(TRAINING).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('preview-image-remove').click();
    await expect(dialog.getByTestId('preview-image-thumb').locator('img')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/login');
    await login(page, 'member');
    const card = cardFor(page, TRAINING);
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('training-card-image')).toHaveCount(0);
    await expect(card.getByTestId('training-card-cover').locator('svg')).toBeVisible();
  });

  test('SYS-SCO-15 / SR-185 / VT-219: a SCORM package with a cover picture is OFFERED as preview image — applied only on the trainer\'s click', async ({ page, request }) => {
    const tokenFor = async (r: APIRequestContext) => {
      const res = await r.post('/api/auth/login', { data: CREDS.trainer });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).token as string;
    };
    const token = await tokenFor(request);
    const created = await request.post('/api/trainings', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `E2E Cover Offer ${Date.now()}` },
    });
    const trainingId = (await created.json()).id as string;

    await login(page, 'trainer');
    await page.goto('/trainings');
    await page.getByText(/E2E Cover Offer/).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('content-kind-scorm').check();
    await dialog.getByRole('button', { name: /^SCORM course/ }).click();
    // A Storyline-style export: meta.xml points at the first-slide thumbnail.
    const zip = await buildScorm12({
      extraFiles: {
        'meta.xml': '<?xml version="1.0" encoding="utf-8"?><meta><project thumburl="story_content/thumbnail.jpg" title="Course"/></meta>',
        'story_content/thumbnail.jpg': PNG_1PX,
      },
    });
    await dialog.locator('input[type="file"][accept=".zip"]').setInputFiles({ name: 'storyline.zip', mimeType: 'application/zip', buffer: zip });
    await expect(dialog.getByTestId('scorm-manifest-card')).toBeVisible();

    // The offer shows the picture; nothing is applied yet — Basics still has no image.
    const offer = dialog.getByTestId('scorm-thumbnail-offer');
    await expect(offer).toBeVisible();
    await expect(offer.locator('img')).toHaveAttribute('src', /^blob:/);
    const thumb = dialog.getByTestId('preview-image-thumb');
    await expect(thumb.locator('img')).toHaveCount(0);
    await dialog.getByTestId('scorm-manifest-card').screenshot({ path: 'test-results/preview-image-scorm-offer.png' });

    // "Not now" hides the offer — but the package picture stays one click away in Basics, next to
    // the local upload, for as long as the package is attached.
    await offer.getByTestId('scorm-thumbnail-dismiss').click();
    await expect(offer).toHaveCount(0);
    const fromPackage = dialog.getByTestId('preview-image-from-scorm');
    await expect(fromPackage).toBeVisible();
    await fromPackage.click();
    await expect(page.getByText('Preview image taken from the course package')).toBeVisible();
    await expect(thumb.locator('img')).toBeVisible();
    await expect(dialog.getByTestId('scorm-thumbnail-offer')).toHaveCount(0);

    // Removing the image does NOT bring the dismissed offer back (a "Not now" holds for the editing
    // session) — the Basics button is the way back to the package picture.
    await dialog.getByTestId('preview-image-remove').click();
    await expect(thumb.locator('img')).toHaveCount(0);
    await expect(dialog.getByTestId('scorm-thumbnail-offer')).toHaveCount(0);
    await fromPackage.click();
    await expect(thumb.locator('img')).toBeVisible();

    // Save: attaching a package stages content, so the publish dialog is offered — keep as draft.
    await dialog.getByRole('button', { name: 'Save' }).click();
    const publish = page.getByTestId('publish-update-dialog');
    await expect(publish).toBeVisible();
    await publish.getByTestId('publish-update-skip').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const saved = await request.get(`/api/trainings/${trainingId}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await saved.json();
    expect(body.previewImage?.type).toBe('image/jpeg');
    expect(body.scormPackages?.draft?.thumbnailHref).toBe('story_content/thumbnail.jpg');

    // EDITING later: reopen the saved training — the image is set, so no offer nags, but the
    // package picture is still selectable in Basics (e.g. after a local upload replaced it).
    await page.getByText(/E2E Cover Offer/).first().click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByTestId('preview-image-thumb').locator('img')).toBeVisible();
    await expect(reopened.getByTestId('scorm-thumbnail-offer')).toHaveCount(0);
    await expect(reopened.getByTestId('preview-image-from-scorm')).toBeVisible();
    await reopened.getByRole('button', { name: 'Cancel' }).click();

    await request.delete(`/api/trainings/${trainingId}`, { headers: { Authorization: `Bearer ${token}` } });
  });
});

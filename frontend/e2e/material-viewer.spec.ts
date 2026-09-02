import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';

// E2E for the in-app learning-material viewer (SYS-TRN-19, traced to SR-184): material the browser
// can render opens INSIDE the app, filling the client area, with the training title, the content
// controls and the full-tab toggle in ONE title line — a PDF as pdf.js page images, text inline, an
// image as a native element. Links that only their own host can render (an authenticated document
// viewer, a page that refuses framing) keep opening in a new tab, where they actually work.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// A real (tiny) PDF — pdf.js must be able to parse it, so a stub byte string will not do.
const PDF = Buffer.from(
  `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 62>>stream
BT /F1 20 Tf 20 60 Td (BrainGain PDF material) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
`,
  'latin1',
);

const createdTrainings: string[] = [];

async function uploadFile(
  request: APIRequestContext,
  token: string,
  name: string,
  type: string,
  data: Buffer,
): Promise<unknown> {
  const res = await request.post(
    `/api/trainings/materials?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    { headers: { ...auth(token), 'content-type': 'application/octet-stream' }, data },
  );
  expect(res.status()).toBe(201);
  return res.json();
}

/** A published training owned by the trainer, carrying the given material variants. */
async function makeTraining(
  request: APIRequestContext,
  token: string,
  variants: Record<string, unknown>[],
): Promise<string> {
  const created = await request.post('/api/trainings', {
    headers: auth(token),
    data: {
      name: `E2E Viewer ${Date.now()}`,
      materials: variants.map((v) => ({ variants: [v] })),
      questions: [],
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id;
  await request.post(`/api/trainings/${id}/publish-update`, { headers: auth(token), data: { kind: 'silent' } });
  createdTrainings.push(id);
  return id;
}

test.describe('Learning material viewer', () => {
  test.afterAll(async ({ request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    for (const id of createdTrainings) {
      await request.delete(`/api/trainings/${id}`, { headers: auth(adminToken) });
    }
  });

  test('SYS-TRN-19 / SR-184 / VT-216: an uploaded PDF opens in the app, filling the client area, with title and full-tab in one title line', async ({ page, request }) => {
    const token = await tokenFor(request, CREDS.trainer);
    const file = await uploadFile(request, token, 'handbook.pdf', 'application/pdf', PDF);
    const trainingId = await makeTraining(request, token, [{ locale: 'en', label: 'Handbook (PDF)', file }]);

    await login(page, 'trainer');
    await page.goto(`/session/${trainingId}`);
    await page.getByTestId('material-open').first().click();

    // Rendered by pdf.js as page images — no native-viewer dependency, so it displays even when the
    // browser is set to download PDFs.
    const viewer = page.getByTestId('content-viewer');
    await expect(viewer).toBeVisible();
    await expect(page.getByTestId('viewer-pages').locator('img')).toHaveCount(1);
    await expect(page.getByTestId('viewer-frame')).toHaveCount(0);

    // ONE title line: the training name, the material label, and the full-tab toggle.
    await expect(viewer).toContainText('E2E Viewer');
    await expect(viewer).toContainText('Handbook (PDF)');
    await expect(page.getByTestId('viewer-full-tab')).toBeVisible();
    // An uploaded file keeps its download path; a file is not third-party content.
    await expect(page.getByTestId('viewer-download')).toBeVisible();
    await expect(page.getByTestId('viewer-third-party')).toHaveCount(0);

    // The viewer fills the client area: right of the sidebar, below the app bars, to the edges.
    const box = (await viewer.boundingBox())!;
    const size = page.viewportSize()!;
    expect(box.x).toBeGreaterThan(200); // the sidebar keeps its place
    expect(box.x + box.width).toBeCloseTo(size.width, 0);
    expect(box.y + box.height).toBeCloseTo(size.height, 0);

    // Full tab: the SAME element grows to cover the whole tab (a class swap — re-creating it would
    // reload the content), and back again.
    await page.getByTestId('viewer-full-tab').click();
    const full = (await viewer.boundingBox())!;
    expect(full).toMatchObject({ x: 0, y: 0 });
    expect(full.width).toBeCloseTo(size.width, 0);
    expect(full.height).toBeCloseTo(size.height, 0);
    await page.getByTestId('viewer-full-tab').click();
    expect((await viewer.boundingBox())!.x).toBeGreaterThan(200);

    // Back returns to the material list.
    await page.getByTestId('viewer-close').click();
    await expect(page.getByTestId('session-material')).toBeVisible();
    await expect(viewer).toHaveCount(0);
  });

  test('SYS-TRN-19 / SR-184 / VT-217: text renders inline and an image as a native element; both without a frame', async ({ page, request }) => {
    const token = await tokenFor(request, CREDS.trainer);
    const txt = await uploadFile(request, token, 'notes.txt', 'text/plain', Buffer.from('Material body line one'));
    const png = await uploadFile(
      request,
      token,
      'diagram.png',
      'image/png',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAJUlEQVR42u3NMQEAAAgDoK3/aC3hARSgM7edAAAAAAAAAAAAAPwPXwYBAAHUcXwAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const trainingId = await makeTraining(request, token, [
      { locale: 'en', label: 'Notes', file: txt },
      { locale: 'en', label: 'Diagram', file: png },
    ]);

    await login(page, 'trainer');
    await page.goto(`/session/${trainingId}`);
    const cards = page.getByTestId('material-open');
    await expect(cards).toHaveCount(2);

    await cards.nth(0).click();
    await expect(page.getByTestId('viewer-text')).toContainText('Material body line one');
    await expect(page.getByTestId('viewer-frame')).toHaveCount(0);
    await page.getByTestId('viewer-close').click();

    await cards.nth(1).click();
    await expect(page.getByTestId('viewer-media')).toBeVisible();
    await expect(page.getByTestId('viewer-frame')).toHaveCount(0);
  });

  test('SYS-TRN-19 / SR-184 / VT-218: links only their own host can render keep opening in a new tab', async ({ page, request }) => {
    const token = await tokenFor(request, CREDS.trainer);
    const trainingId = await makeTraining(request, token, [
      // A SharePoint sharing link: it ENDS in .pdf but serves an authenticated viewer page that
      // refuses framing — embedding it would leave a permanently blank frame.
      { locale: 'en', label: 'SharePoint PDF', url: 'https://example.sharepoint.com/:b:/r/sites/x/doc.pdf?csf=1&web=1' },
      // A plain page.
      { locale: 'en', label: 'Intranet page', url: 'https://intranet.example/policy/showfile.aspx?FileID=1' },
      // A link straight AT a file — this one the app can render itself.
      { locale: 'en', label: 'Direct PDF', url: 'https://files.example/guide.pdf' },
    ]);

    await login(page, 'trainer');
    await page.goto(`/session/${trainingId}`);

    // Only the direct file link is offered in the viewer; the other two stay external links.
    await expect(page.getByTestId('material-open')).toHaveCount(1);
    const external = page.locator('[data-testid="session-material"] a[target="_blank"]');
    await expect(external).toHaveCount(2);
    await expect(external.first()).toHaveAttribute('rel', /noopener/);

    // The embeddable link is framed — sandboxed, cross-origin, labelled third-party, and it always
    // offers the original URL because the host may still refuse to be framed.
    await page.getByTestId('material-open').click();
    const frame = page.getByTestId('viewer-frame');
    await expect(frame).toBeVisible();
    const sandbox = await frame.getAttribute('sandbox');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin'); // cross-origin source: grants it only its OWN origin
    expect(sandbox).not.toContain('allow-top-navigation'); // must not navigate the app away
    await expect(page.getByTestId('viewer-third-party')).toBeVisible();
    await expect(page.getByTestId('viewer-external')).toHaveAttribute('href', 'https://files.example/guide.pdf');
  });
});

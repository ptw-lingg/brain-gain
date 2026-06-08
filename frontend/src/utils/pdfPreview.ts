// In-app PDF preview: render PDF bytes to page images with pdf.js, so the controlled documents are
// reviewed INLINE (regardless of the browser's PDF-download setting, and in headless e2e) instead of
// being handed to the browser's native viewer (which would download them). Lazy-imported, so pdf.js
// stays in the internal-only chunk and out of the public bundle.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
// Inline the worker (?worker&inline) rather than emit it as a separate ?url asset: a ?url asset is
// emitted eagerly and would leak into the PUBLIC bundle, but an inlined worker lives inside this lazy
// chunk and is tree-shaken out of the public build along with the rest of the internal-only tooling.
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';

GlobalWorkerOptions.workerPort = new PdfjsWorker();

/** Render every page of a PDF to a PNG data URL (one per page), for inline display. */
export async function renderPdfToImages(data: ArrayBuffer, scale = 1.3): Promise<string[]> {
  const pdf = await getDocument({ data }).promise;
  const pages: string[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      pages.push(canvas.toDataURL('image/png'));
      page.cleanup();
    }
  } finally {
    await pdf.cleanup();
  }
  return pages;
}

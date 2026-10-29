// Builds the IMS training: renders decks/ims*.html to out/*.pdf (16:9, headless Edge) and then runs
// install.mjs, which copies the PDFs into DATA_DIR/materials and upserts the training record into
// trainings.json (published; a content change publishes the next version silently). install.mjs
// alone (no browser needed) is what release/ims-training.tgz ships to a server.
//
//   node tools/ims-training/build.mjs [--no-install] [--data <dir>] [--owner <email>]

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IMS as def } from './content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const argv = process.argv.slice(2);
const argValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const outDir = join(here, 'out');

// ── render (one PDF per language, previews in out/preview/<locale>-NN.png) ──
const require = createRequire(join(root, 'frontend', 'package.json'));
const pw = await import(pathToFileURL(require.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default?.chromium;
mkdirSync(join(outDir, 'preview'), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const deck of def.decks) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(pathToFileURL(join(here, 'decks', deck.html)).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    const slides = [...document.querySelectorAll('.slide')];
    slides.forEach((s, i) => {
      const p = s.querySelector('.page');
      if (p) p.textContent = `${i + 1} / ${slides.length}`;
    });
    await Promise.all([...document.images].map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
    await document.fonts?.ready;
  });
  await page.pdf({ path: join(outDir, deck.pdf), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  const slides = page.locator('.slide');
  const n = await slides.count();
  for (let i = 0; i < n; i++) await slides.nth(i).screenshot({ path: join(outDir, 'preview', `${deck.locale}-${String(i + 1).padStart(2, '0')}.png`) });
  await page.close();
  console.log(`[render] ${deck.pdf} — ${n} slides`);
}
await browser.close();

// ── install (same process, so --data / --owner flow through process.argv) ──
if (!argv.includes('--no-install')) await import('./install.mjs');

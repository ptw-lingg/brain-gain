// Screenshots every slide of decks/*.html into out/preview/<deck>.<locale>-<n>.png — a quick visual
// check of the layout without opening the PDF.
//
//   node tools/self-training/preview.mjs [trainee.en|trainer.de|…]

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOCALES, TRAININGS } from './content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..', '..', 'frontend');
const outDir = join(here, 'out', 'preview');
const require = createRequire(join(frontendRoot, 'package.json'));
const pw = await import(pathToFileURL(require.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default?.chromium;

const all = TRAININGS.flatMap((d) => LOCALES.map((l) => `${d.deck}.${l}`));
const decks = process.argv.slice(2).length ? process.argv.slice(2) : all;
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const deck of decks) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(pathToFileURL(join(here, 'decks', `${deck}.html`)).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    const slides = [...document.querySelectorAll('.slide')];
    slides.forEach((s, i) => { const p = s.querySelector('.page'); if (p) p.textContent = `${i + 1} / ${slides.length}`; });
    await Promise.all([...document.images].map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
    await document.fonts?.ready;
  });
  const slides = page.locator('.slide');
  const n = await slides.count();
  for (let i = 0; i < n; i++) {
    await slides.nth(i).screenshot({ path: join(outDir, `${deck}-${String(i + 1).padStart(2, '0')}.png`) });
  }
  console.log(`[preview] ${deck}: ${n} slides → ${outDir}`);
  await page.close();
}
await browser.close();

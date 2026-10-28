// Renders decks/<deck>.<locale>.html to out/<pdf> (16:9, one slide per page) with headless Edge via
// Playwright — one PDF per training and language.
//
//   node tools/self-training/render.mjs

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOCALES, TRAININGS } from './content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..', '..', 'frontend');
const outDir = join(here, 'out');

const require = createRequire(join(frontendRoot, 'package.json'));
const pw = await import(pathToFileURL(require.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default?.chromium;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
for (const def of TRAININGS) {
  for (const locale of LOCALES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(pathToFileURL(join(here, 'decks', `${def.deck}.${locale}.html`)).href, { waitUntil: 'load' });
    // Slide numbers in the footer; wait for every embedded screenshot to decode and fonts to load.
    await page.evaluate(async () => {
      const slides = [...document.querySelectorAll('.slide')];
      slides.forEach((s, i) => {
        const p = s.querySelector('.page');
        if (p) p.textContent = `${i + 1} / ${slides.length}`;
      });
      await Promise.all([...document.images].map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
      await document.fonts?.ready;
    });
    const path = join(outDir, def.pdf[locale]);
    await page.pdf({ path, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    const n = await page.locator('.slide').count();
    console.log(`[render] ${def.pdf[locale]} — ${n} slides`);
    await page.close();
  }
}
await browser.close();

// Builds the IMS training: renders decks/ims.html to out/*.pdf (16:9, headless Edge) and installs it
// into a BrainGain data directory — PDF into DATA_DIR/materials, training record upserted into
// trainings.json (published; a content change publishes the next version silently). Same mechanics
// as tools/self-training/install.mjs.
//
//   node tools/ims-training/build.mjs [--no-install] [--data <dir>] [--owner <email>]

import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

if (argv.includes('--no-install')) process.exit(0);

// ── install ──
const dataDir = resolve(argValue('--data') ?? join(root, 'backend', 'src', 'data'));
const ownerEmail = argValue('--owner');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf-8'));
const users = readJson(join(dataDir, 'users.json'));
const owner = ownerEmail
  ? users.find((u) => u.email.toLowerCase() === ownerEmail.toLowerCase())
  : (users.find((u) => u.isAdmin && u.isTrainer) ?? users.find((u) => u.isTrainer));
if (!owner) throw new Error(`[install] no owner found${ownerEmail ? ` for ${ownerEmail}` : ''} in ${dataDir}/users.json`);

const derived = (kind, i) => `${def.id.slice(0, 24)}${kind}${String(i).padStart(11, '0')}`;
mkdirSync(join(dataDir, 'materials'), { recursive: true });
// One material, one variant per language — learners get the PDF in their own locale.
const variants = def.decks.map((deck, i) => {
  const fileId = derived('f', i + 1);
  const pdfPath = join(outDir, deck.pdf);
  copyFileSync(pdfPath, join(dataDir, 'materials', fileId));
  const meta = { name: deck.pdf, size: statSync(pdfPath).size, type: 'application/pdf' };
  writeFileSync(join(dataDir, 'materials', `${fileId}.meta.json`), JSON.stringify(meta));
  return { locale: deck.locale, label: deck.label, file: { id: fileId, ...meta } };
});

const trainingsFile = join(dataDir, 'trainings.json');
const trainings = readJson(trainingsFile);
const materials = [{ id: derived('a', 1), variants }];
const questions = def.questions.map((q, i) => ({ ...q, id: derived('b', i + 1) }));
const existing = trainings.find((t) => t.id === def.id);
const changed = !existing || JSON.stringify([existing.materials, existing.questions]) !== JSON.stringify([materials, questions]);
const now = new Date().toISOString();
const record = {
  id: def.id,
  name: def.name,
  description: def.description,
  durationMinutes: def.durationMinutes,
  category: def.category,
  ownerId: existing?.ownerId ?? owner.id,
  cycleYears: def.cycleYears,
  windowBeforeMonths: def.windowBeforeMonths,
  windowAfterMonths: def.windowAfterMonths,
  order: existing?.order ?? trainings.reduce((max, t) => Math.max(max, t.order ?? -1), -1) + 1,
  materials,
  questions,
  version: existing ? (changed ? existing.version + 1 : existing.version) : 1,
  publishedAt: existing && !changed ? existing.publishedAt : now,
  updates: existing?.updates ?? [],
  ...(existing?.previewImage ? { previewImage: existing.previewImage } : {}),
  createdAt: existing?.createdAt ?? now,
};
if (existing) Object.assign(existing, record), delete existing.draft;
else trainings.push(record);
writeFileSync(trainingsFile, JSON.stringify(trainings, null, 2) + '\n');
console.log(`[install] ${def.name.en} → version ${record.version}${existing ? (changed ? ' (content changed)' : ' (unchanged)') : ' (new)'}, PDFs ${variants.map((v) => `${v.locale} ${v.file.size} B`).join(', ')}, owner ${owner.email}, ${trainingsFile}`);

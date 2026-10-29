// Installs the IMS training into a BrainGain data directory: copies the rendered PDFs (one per
// language) from out/ into DATA_DIR/materials (with their .meta.json sidecars) and upserts the
// training record into trainings.json — published, so trainees can take it right away. Idempotent:
// the training and its material files have fixed ids, so a re-run replaces the PDFs and, when the
// content changed, publishes the next version silently. Needs only Node — no browser — so it is what
// release/ims-training.tgz ships to a server. Same mechanics as tools/self-training/install.mjs.
//
//   node tools/ims-training/install.mjs [--data <dir>] [--owner <email>]
//
// Defaults: the git-tracked backend/src/data, owner = the first user who is both admin and trainer
// (falling back to the first trainer). The store is read per request, so a running server picks the
// files up without a restart; stop the service anyway while installing so nothing writes concurrently.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMS as def } from './content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const argv = process.argv.slice(2);
const argValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const dataDir = resolve(argValue('--data') ?? join(root, 'backend', 'src', 'data'));
const ownerEmail = argValue('--owner');
const outDir = join(here, 'out');

const readJson = (f) => JSON.parse(readFileSync(f, 'utf-8'));
const users = readJson(join(dataDir, 'users.json'));
const owner = ownerEmail
  ? users.find((u) => u.email.toLowerCase() === ownerEmail.toLowerCase())
  : (users.find((u) => u.isAdmin && u.isTrainer) ?? users.find((u) => u.isTrainer));
if (!owner) throw new Error(`[install] no owner found${ownerEmail ? ` for ${ownerEmail}` : ''} in ${dataDir}/users.json`);

// Fixed UUID-shaped ids derived from the training id: material group ('a'), files ('f'), questions ('b').
const derived = (kind, i) => `${def.id.slice(0, 24)}${kind}${String(i).padStart(11, '0')}`;
mkdirSync(join(dataDir, 'materials'), { recursive: true });
// One material, one variant per language — learners get the PDF in their own locale.
const variants = def.decks.map((deck, i) => {
  const fileId = derived('f', i + 1);
  const pdfPath = join(outDir, deck.pdf);
  if (!existsSync(pdfPath)) throw new Error(`[install] missing ${pdfPath} — run build.mjs first`);
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
// Object.assign keeps server-side master data the installer does not own (assignment, …).
if (existing) Object.assign(existing, record), delete existing.draft;
else trainings.push(record);
writeFileSync(trainingsFile, JSON.stringify(trainings, null, 2) + '\n');
console.log(`[install] ${def.name.en} → version ${record.version}${existing ? (changed ? ' (content changed)' : ' (unchanged)') : ' (new)'}, PDFs ${variants.map((v) => `${v.locale} ${v.file.size} B`).join(', ')}, owner ${owner.email}, ${trainingsFile}`);

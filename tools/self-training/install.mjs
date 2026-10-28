// Installs the two self-trainings into a BrainGain data directory: copies the rendered PDFs (one per
// language) into DATA_DIR/materials (with their .meta.json sidecars) and upserts the training records
// into trainings.json — published, so trainees can take them right away. Idempotent: the trainings
// and their material files have fixed ids, so a re-run replaces the PDFs and, when the content
// changed, publishes the next version silently.
//
//   node tools/self-training/install.mjs [--data <dir>] [--owner <email>]
//
// Defaults: the git-tracked backend/src/data, owner = the first user who is both admin and trainer
// (falling back to the first trainer). The store is read per request, so a running server picks the
// files up without a restart.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, TRAININGS } from './content.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const argv = process.argv.slice(2);
const argValue = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const dataDir = resolve(argValue('--data') ?? join(root, 'backend', 'src', 'data'));
const ownerEmail = argValue('--owner');
const outDir = join(here, 'out');

const readJson = (f) => JSON.parse(readFileSync(f, 'utf-8'));
const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n');

const users = readJson(join(dataDir, 'users.json'));
const owner = ownerEmail
  ? users.find((u) => u.email.toLowerCase() === ownerEmail.toLowerCase())
  : (users.find((u) => u.isAdmin && u.isTrainer) ?? users.find((u) => u.isTrainer));
if (!owner) throw new Error(`[install] no owner found${ownerEmail ? ` for ${ownerEmail}` : ''} in ${dataDir}/users.json`);

const trainingsFile = join(dataDir, 'trainings.json');
const trainings = readJson(trainingsFile);
const materialsDir = join(dataDir, 'materials');
mkdirSync(materialsDir, { recursive: true });

// Fixed UUID-shaped ids derived from the training id: material group ('a'), files ('f'), questions ('b').
const derived = (id, kind, n) => `${id.slice(0, 24)}${kind}${String(n).padStart(11, '0')}`;

const now = new Date().toISOString();
for (const def of TRAININGS) {
  const variants = LOCALES.map((locale, i) => {
    const pdfPath = join(outDir, def.pdf[locale]);
    if (!existsSync(pdfPath)) throw new Error(`[install] missing ${pdfPath} — run render.mjs first`);
    const fileId = derived(def.id, 'f', i + 1);
    copyFileSync(pdfPath, join(materialsDir, fileId));
    const meta = { name: def.pdf[locale], size: statSync(pdfPath).size, type: 'application/pdf' };
    writeFileSync(join(materialsDir, `${fileId}.meta.json`), JSON.stringify(meta));
    return { locale, label: def.materialLabel[locale], file: { id: fileId, ...meta } };
  });
  const materials = [{ id: derived(def.id, 'a', 1), variants }];
  const questions = def.questions.map((q, i) => ({ ...q, id: derived(def.id, 'b', i + 1) }));

  const existing = trainings.find((t) => t.id === def.id);
  const contentKey = (m, qs) => JSON.stringify([m, qs]);
  const changed = !existing || contentKey(existing.materials, existing.questions) !== contentKey(materials, questions);
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
  const sizes = variants.map((v) => `${v.locale} ${v.file.size} B`).join(', ');
  console.log(`[install] ${def.name.en} → version ${record.version}${existing ? (changed ? ' (content changed)' : ' (unchanged)') : ' (new)'}, PDFs ${sizes}, owner ${owner.email}`);
}
writeJson(trainingsFile, trainings);
console.log(`[install] wrote ${trainingsFile}`);

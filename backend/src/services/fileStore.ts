import { promises as fs } from 'fs';
import path from 'path';
import type { Settings } from '../types';

// Defaults to backend/src/data; override with DATA_DIR (used by the automated test harness to
// run against an isolated, throwaway data directory).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');

/** The active data directory — one definition, so tls.ts and backup.ts resolve the same path. */
export function dataDir(): string {
  return DATA_DIR;
}

// The array stores, and — derived from them — every JSON store the app persists. STORE_FILES is the
// allowlist backup.ts archives and restores, and ArrayFile is derived FROM it rather than declared
// beside it: a new store can only be added by extending this list, so it cannot be introduced through
// readStore/writeStore and then be silently missing from backups.
// Deliberate exception: the audit log (audit.ndjson) is NOT a store — it is archived by backup.ts
// as evidence but must never be restored (restoring old data may not erase newer audit history).
// See services/audit.ts.
export const ARRAY_FILES = [
  'users',
  'roles',
  'trainings',
  'sessions',
  'orgUnits',
  'updateAcks',
  'scormPackages',
  'scormAttempts',
] as const;
export type ArrayFile = (typeof ARRAY_FILES)[number];
export const STORE_FILES = [...ARRAY_FILES, 'settings'] as const;
export type StoreFile = (typeof STORE_FILES)[number];

/** Absolute path of a JSON store — the one place the `<name>.json` layout is encoded. */
export function storeFilePath(name: StoreFile): string {
  return filePath(name);
}

/** The uploaded-material files present on disk (bytes and their `<id>.meta.json` sidecars). */
export async function listMaterialFiles(): Promise<string[]> {
  try {
    return await fs.readdir(MATERIALS_DIR);
  } catch {
    return []; // nothing uploaded yet
  }
}

/** Absolute path of one entry inside the materials directory (bytes or sidecar). */
export function materialFilePath(entry: string): string {
  return path.join(MATERIALS_DIR, entry);
}

function filePath(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// ── Uploaded learning-material files ────────────────────────────────────────────────────────────
// Each file's bytes are stored under DATA_DIR/materials/<id>, with a sibling <id>.meta.json holding
// the descriptor so the download endpoint can set the right filename/type without consulting trainings.
const MATERIALS_DIR = path.join(DATA_DIR, 'materials');

export interface StoredMaterialMeta {
  name: string;
  size: number;
  type: string;
}

function materialPath(id: string): string {
  return path.join(MATERIALS_DIR, id);
}

export async function saveMaterial(id: string, bytes: Buffer, meta: StoredMaterialMeta): Promise<void> {
  await fs.mkdir(MATERIALS_DIR, { recursive: true });
  await fs.writeFile(materialPath(id), bytes);
  await fs.writeFile(`${materialPath(id)}.meta.json`, JSON.stringify(meta), 'utf-8');
}

export async function readMaterial(id: string): Promise<{ bytes: Buffer; meta: StoredMaterialMeta } | null> {
  try {
    const [bytes, metaRaw] = await Promise.all([
      fs.readFile(materialPath(id)),
      fs.readFile(`${materialPath(id)}.meta.json`, 'utf-8'),
    ]);
    return { bytes, meta: JSON.parse(metaRaw) as StoredMaterialMeta };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteMaterial(id: string): Promise<void> {
  await Promise.allSettled([
    fs.rm(materialPath(id), { force: true }),
    fs.rm(`${materialPath(id)}.meta.json`, { force: true }),
  ]);
}

// ── SCORM package trees and attempt files ────────────────────────────────────────────────────────
// A SCORM package is an exploded directory tree at DATA_DIR/scorm/<packageId>/… with the archive's
// ORIGINAL relative paths preserved (an SCO's HTML resolves assets relatively, so paths cannot be
// flattened the way material names are). The descriptor lives in the scormPackages store.
// A SCORM attempt's authoritative cmi is one JSON file at DATA_DIR/scorm-attempts/<attemptId>.json,
// written via temp+rename so a crash mid-write can never truncate a learner's suspend data.
const SCORM_DIR = path.join(DATA_DIR, 'scorm');
const SCORM_ATTEMPTS_DIR = path.join(DATA_DIR, 'scorm-attempts');

/** Absolute directory of one package's extracted files. Caller must have UUID-validated the id. */
export function scormPackageDir(packageId: string): string {
  return path.join(SCORM_DIR, packageId);
}

/**
 * Resolve a POSIX-relative entry path inside a package directory, or null when it would escape.
 * THE ONE place the containment check lives — used at import time (the security boundary) AND at
 * serve time (belt and braces, so an encoded `..` can never reach the filesystem even if a future
 * refactor mishandles decoding): normalize separators, reject absolute/drive-letter/UNC forms and
 * dot segments, then require the resolved path to stay under the package directory.
 */
export function resolveScormEntry(packageId: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 1024) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(relPath)) return null;
  const posix = relPath.replace(/\\/g, '/');
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix) || posix.startsWith('//')) return null;
  const segments = posix.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  const dir = scormPackageDir(packageId);
  const abs = path.resolve(dir, ...segments);
  if (!abs.startsWith(dir + path.sep)) return null;
  return abs;
}

export async function writeScormEntry(packageId: string, relPath: string, bytes: Buffer): Promise<void> {
  const abs = resolveScormEntry(packageId, relPath);
  if (!abs) throw new Error(`unsafe scorm entry path: ${relPath}`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, bytes);
}

/** Every file in a package tree, as POSIX-relative paths ([] when the package has no directory). */
export async function listScormEntries(packageId: string): Promise<string[]> {
  const dir = scormPackageDir(packageId);
  const out: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(childRel);
      else if (e.isFile()) out.push(childRel);
    }
  }
  try {
    await walk('');
  } catch {
    return [];
  }
  return out;
}

/** The package directories present on disk (their names are package ids). */
export async function listScormPackageDirs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SCORM_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function deleteScormPackageFiles(packageId: string): Promise<void> {
  await fs.rm(scormPackageDir(packageId), { recursive: true, force: true });
}

export function scormAttemptPath(attemptId: string): string {
  return path.join(SCORM_ATTEMPTS_DIR, `${attemptId}.json`);
}

export async function readScormAttemptFile<T>(attemptId: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(scormAttemptPath(attemptId), 'utf-8')) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Write via temp+rename: an ack to the client means the attempt state is durably on disk. */
export async function writeScormAttemptFile<T>(attemptId: string, data: T): Promise<void> {
  await fs.mkdir(SCORM_ATTEMPTS_DIR, { recursive: true });
  const target = scormAttemptPath(attemptId);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf-8');
  await fs.rename(tmp, target);
}

/** Attempt file names on disk (the `<attemptId>.json` entries). */
export async function listScormAttemptFiles(): Promise<string[]> {
  try {
    return (await fs.readdir(SCORM_ATTEMPTS_DIR)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
}

export async function deleteScormAttemptFile(attemptId: string): Promise<void> {
  await fs.rm(scormAttemptPath(attemptId), { force: true });
}

export async function readStore<T>(file: ArrayFile): Promise<T[]> {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath(file), 'utf-8');
    return JSON.parse(raw) as T[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.writeFile(filePath(file), '[]', 'utf-8');
      return [];
    }
    throw err;
  }
}

export async function writeStore<T>(file: ArrayFile, data: T[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(filePath(file), JSON.stringify(data, null, 2), 'utf-8');
}

const DEFAULT_SETTINGS: Settings = {
  passThreshold: 0.8,
  revealWrongQuestions: false,
  companyName: 'PTW Dosimetry',
  entra: { enabled: false, tenantId: '', clientId: '', allowedDomains: [] },
  tls: null,
  smtp: { enabled: false, host: '', port: 587, secure: false, username: '', password: '', fromName: '', fromAddress: '' },
  // Off by default — an admin opts in. The shallow spread in readSettings backfills the whole
  // object for a settings.json written before the feature existed; a PARTIAL stored object cannot
  // occur because routes/settings.ts always writes the complete shape.
  autoBackup: { enabled: false, intervalDays: 7, keep: 5 },
};

export async function readSettings(): Promise<Settings> {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath('settings'), 'utf-8');
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await writeSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    throw err;
  }
}

export async function writeSettings(data: Settings): Promise<void> {
  await ensureDir();
  await fs.writeFile(filePath('settings'), JSON.stringify(data, null, 2), 'utf-8');
}

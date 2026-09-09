import { promises as fs } from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import type { Settings } from '../types';

// ── Concurrency model ─────────────────────────────────────────────────────────────────────────────
// Node is single-threaded, but every `await` is a yield point: two requests that both read a store
// before either writes it lose one update. Two rules keep the JSON stores consistent:
//   1. Every read-modify-write runs inside `transaction()` (or its `updateStore`/`updateSettings`
//      wrappers), which holds ONE process-wide store lock across the callback. One lock — not one per
//      store — because most mutations touch several stores (a training save cleans up its package,
//      a graded SCORM attempt writes a session and closes the attempt) and one lock cannot deadlock.
//      The lock is re-entrant via AsyncLocalStorage: a helper that calls updateStore from inside a
//      transaction runs inline instead of waiting for itself.
//   2. Every JSON write goes through `writeJsonAtomic` (temp + rename), so a reader never observes a
//      half-written file and a crash mid-write never truncates a store. Plain reads therefore need no
//      lock: they see either the previous or the next complete version.
// Deliberately OUTSIDE this lock: the SCORM attempt index (services/scorm/attempts.ts owns it through
// its own queues, and a commit must never wait on a long transaction), the audit log (own append
// queue) and the backup archive queue (which nests this lock INSIDE it, never the other way round).

const inTransaction = new AsyncLocalStorage<true>();
let storeQueue: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` holding the store lock. Callers already inside a transaction run inline (re-entrant).
 * Keep slow, state-independent work (bcrypt, mail, network) OUTSIDE the callback.
 */
export function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (inTransaction.getStore()) return fn();
  const run = storeQueue.then(() => inTransaction.run(true, fn));
  storeQueue = run.catch(() => undefined); // a failure must not poison the chain
  return run;
}

/** True while the caller is inside `transaction()` — for assertions in code that must be locked. */
export function insideTransaction(): boolean {
  return inTransaction.getStore() === true;
}

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

// The data-version marker (services/dataVersion.ts). Deliberately NOT a store: it is not an array, it
// must never be swapped by a restore (the restore writes it explicitly from the archive's manifest),
// and backup.ts archives it as a read-only passenger next to the audit log.
export const DATA_META_FILE = '_meta.json';
export function dataMetaFilePath(): string {
  return path.join(DATA_DIR, DATA_META_FILE);
}

const TMP_SUFFIX = '.tmp';
let tmpCounter = 0;

/**
 * Rename, retrying briefly on the transient Windows failures (EPERM/EBUSY/EACCES) that occur when a
 * virus scanner or indexer still holds the target for a moment. A rename that keeps failing is a real
 * error and propagates.
 */
export async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw err;
      await new Promise((resolve) => setTimeout(resolve, 25 * i));
    }
  }
}

/**
 * Write text via temp+rename so a crash mid-write can never leave a truncated file behind and a
 * concurrent reader never sees a partial file. The temp name is unique per write (pid + counter), so
 * two unserialized writers of the same target — e.g. two first-time readStore() initializations —
 * cannot rename each other's temp file away.
 */
export async function writeFileAtomic(target: string, text: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${++tmpCounter}${TMP_SUFFIX}`;
  try {
    await fs.writeFile(tmp, text);
    await renameWithRetry(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Write JSON via temp+rename (see writeFileAtomic). */
export async function writeJsonAtomic(target: string, data: unknown, pretty = false): Promise<void> {
  await writeFileAtomic(target, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

/**
 * Remove temp files a crash left behind next to the stores (boot-time hygiene). Only the data
 * directory's top level: attempt files and the marker live elsewhere and are swept by their owners'
 * orphan handling (gcScorm) or simply overwritten.
 */
export async function sweepTempFiles(): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(DATA_DIR);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    if (!name.endsWith(TMP_SUFFIX)) continue;
    await fs.rm(path.join(DATA_DIR, name), { force: true }).catch(() => undefined);
    removed += 1;
  }
  return removed;
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

/**
 * Bytes first, sidecar second — both via temp+rename. The sidecar is what makes the upload visible
 * (readMaterial needs both), so a crash in between leaves orphan bytes, never a half-written
 * descriptor or a descriptor pointing at truncated bytes.
 */
export async function saveMaterial(id: string, bytes: Buffer, meta: StoredMaterialMeta): Promise<void> {
  await writeFileAtomic(materialPath(id), bytes);
  await writeFileAtomic(`${materialPath(id)}.meta.json`, JSON.stringify(meta));
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

/** The stored descriptor alone (no bytes) — for validating a reference without reading the file. */
export async function readMaterialMeta(id: string): Promise<StoredMaterialMeta | null> {
  try {
    return JSON.parse(await fs.readFile(`${materialPath(id)}.meta.json`, 'utf-8')) as StoredMaterialMeta;
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
  await writeJsonAtomic(scormAttemptPath(attemptId), data);
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

/**
 * Read a store. Safe without the lock for DISPLAY: writes are atomic, so the result is always one
 * complete version. A read that feeds a write must happen inside transaction()/updateStore().
 */
export async function readStore<T>(file: ArrayFile): Promise<T[]> {
  await ensureDir();
  try {
    const raw = await fs.readFile(filePath(file), 'utf-8');
    return JSON.parse(raw) as T[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await writeFileAtomic(filePath(file), '[]');
      return [];
    }
    throw err;
  }
}

/**
 * Replace a store's contents atomically. Does NOT take the store lock: the SCORM attempt index is
 * written through its own queue and must be able to write while a transaction is open (a commit
 * waiting on the store lock would deadlock a transaction that waits on the commit). Every other
 * caller reaches this from inside transaction()/updateStore().
 */
export async function writeStore<T>(file: ArrayFile, data: T[]): Promise<void> {
  await ensureDir();
  await writeJsonAtomic(filePath(file), data, true);
}

/**
 * Read-modify-write one store under the store lock. The callback receives the current items and
 * returns the array to persist, or null to persist nothing (validation failed, nothing changed).
 * Return values for the caller travel through closure variables, keeping the write decision explicit.
 */
export function updateStore<T>(
  file: ArrayFile,
  fn: (items: T[]) => T[] | null | Promise<T[] | null>,
): Promise<void> {
  return transaction(async () => {
    const next = await fn(await readStore<T>(file));
    if (next !== null) await writeStore(file, next);
  });
}

// Exported for the 1.3.0 migration step, which prunes stored keys that are not in this shape.
export const DEFAULT_SETTINGS: Settings = {
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
  await writeJsonAtomic(filePath('settings'), data, true);
}

/** Read-modify-write the settings object under the store lock (null = persist nothing). */
export function updateSettings(
  fn: (settings: Settings) => Settings | null | Promise<Settings | null>,
): Promise<void> {
  return transaction(async () => {
    const next = await fn(await readSettings());
    if (next !== null) await writeSettings(next);
  });
}

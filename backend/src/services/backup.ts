// Backup & restore of all app data.
//
// A backup is a ZIP built from an explicit ALLOWLIST of what counts as app data: the JSON stores named
// by fileStore.STORE_FILES plus the uploaded material files. Because both archiving and restoring work
// off that same allowlist:
//   - data/tls/ is never archived (the private key must never leave the server — see tls.ts) and a
//     restore never touches the running certificate,
//   - data/backups/ is never archived (no self-inclusion / recursion) and survives a restore, so the
//     backup list — including the safety backup just taken — is still there afterwards.
// STORE_FILES is also the source of the ArrayFile type, so a new store cannot be added without
// appearing in backups.
//
// The audit log (data/audit.ndjson) is a deliberate one-way passenger: every archive CARRIES a copy
// as evidence, but it is recorded in the manifest's separate `audit` field — never in `files` — so a
// restore (which stages and swaps only `files` stores) can never overwrite the local audit history.
// The archived copy is never imported anywhere, including on a fresh install; each installation's
// local log is the sole authoritative record of what happened on that installation.
//
// Archives are stored server-side as DATA_DIR/backups/<uuid>.zip with a sibling <uuid>.meta.json,
// the same id + sidecar scheme fileStore.ts uses for materials: the id in a URL path is a UUID, so it
// cannot traverse, and the human-readable download name lives in the sidecar.
//
// Restore is validate → automatic pre-restore backup → write to a staging dir → swap into place, so an
// invalid or truncated archive can never leave the dataset half-written.

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import JSZip from 'jszip';
import {
  dataDir,
  listMaterialFiles,
  listScormAttemptFiles,
  listScormEntries,
  listScormPackageDirs,
  materialFilePath,
  resolveScormEntry,
  scormAttemptPath,
  scormPackageDir,
  STORE_FILES,
  storeFilePath,
  type StoreFile,
} from './fileStore';
import { auditFilePath } from './audit';

const BACKUPS_DIR_NAME = 'backups';
const STAGING_DIR_NAME = '.restore-staging';
const MATERIALS_PREFIX = 'data/materials/';
// SCORM package trees (data/scorm/<packageId>/<original relative path…>) and attempt files
// (data/scorm-attempts/<attemptId>.json). Both prefixes are OPTIONAL in an archive — a pre-SCORM
// backup restores unchanged, so FORMAT_VERSION stays 1.
const SCORM_PREFIX = 'data/scorm/';
const SCORM_ATTEMPTS_PREFIX = 'data/scorm-attempts/';
const MANIFEST = 'manifest.json';
const APP = 'BrainGain';
const FORMAT_VERSION = 1;

export type BackupSource = 'manual' | 'pre-restore' | 'upload' | 'auto';

export interface BackupMeta {
  id: string;
  fileName: string;
  createdAt: string;
  size: number;
  source: BackupSource;
  // scormPackages is absent on archives that predate SCORM support (readers use `?? 0`).
  contents: { users: number; trainings: number; materials: number; scormPackages?: number };
}

/** Thrown when an archive isn't a usable BrainGain backup → mapped to HTTP 400 by the route. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** The requested backup does not exist → mapped to HTTP 404 (a typed case, not a message match). */
export class BackupNotFound extends BackupError {
  constructor() {
    super('Backup not found');
    this.name = 'BackupNotFound';
  }
}

/**
 * A restore that failed AFTER the pre-restore snapshot was written. The dataset may be partially
 * updated; the snapshot id is the way back, so it travels with the error.
 */
export class RestoreFailed extends Error {
  constructor(message: string, readonly safetyBackupId: string, readonly cause?: unknown) {
    super(message);
    this.name = 'RestoreFailed';
  }
}

const backupsDir = (): string => path.join(dataDir(), BACKUPS_DIR_NAME);
const zipPath = (id: string): string => path.join(backupsDir(), `${id}.zip`);
const metaPath = (id: string): string => path.join(backupsDir(), `${id}.meta.json`);

// Backup and restore rewrite whole files and read the whole data dir, so only one heavy data operation
// runs at a time — an upload's validation is included so a large archive cannot land mid-restore.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => undefined); // a failure must not poison the chain
  return run;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Rename, retrying briefly on the transient Windows failures (EPERM/EBUSY/EACCES) that occur when a
 * virus scanner or indexer still holds the file for a moment. A rename that keeps failing is a real
 * error and propagates.
 */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
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

const countOf = (raw: string | undefined): number => {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
};

/** Material entries inside an archive, keyed by their base name (directories/empty names skipped). */
function zipMaterials(zip: JSZip): { base: string; entry: JSZip.JSZipObject }[] {
  const out: { base: string; entry: JSZip.JSZipObject }[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith(MATERIALS_PREFIX)) continue;
    const base = path.posix.basename(name); // ignore any nested path from the archive
    if (base) out.push({ base, entry });
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SCORM package entries inside an archive: package id + relative path, each GUARDED. Unlike
 * materials these keep their nested paths (an SCO resolves assets relatively), so an uploaded
 * archive's paths are untrusted — we cannot basename them away. Instead: the first segment must be
 * a UUID (the package id) and the remainder must pass resolveScormEntry's containment check;
 * anything else is silently skipped, never written.
 */
function zipScormEntries(zip: JSZip): { pkgId: string; rel: string; entry: JSZip.JSZipObject }[] {
  const out: { pkgId: string; rel: string; entry: JSZip.JSZipObject }[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith(SCORM_PREFIX)) continue;
    const remainder = name.slice(SCORM_PREFIX.length);
    const slash = remainder.indexOf('/');
    if (slash <= 0) continue;
    const pkgId = remainder.slice(0, slash);
    const rel = remainder.slice(slash + 1);
    if (!UUID_RE.test(pkgId) || !rel) continue;
    if (resolveScormEntry(pkgId, rel) === null) continue;
    out.push({ pkgId, rel, entry });
  }
  return out;
}

/** SCORM attempt files inside an archive (flat `<uuid>.json` entries; anything else is skipped). */
function zipScormAttempts(zip: JSZip): { id: string; entry: JSZip.JSZipObject }[] {
  const out: { id: string; entry: JSZip.JSZipObject }[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith(SCORM_ATTEMPTS_PREFIX)) continue;
    const base = path.posix.basename(name);
    if (!base.endsWith('.json')) continue;
    const id = base.slice(0, -'.json'.length);
    if (UUID_RE.test(id)) out.push({ id, entry });
  }
  return out;
}

/** Uploads (not raw entries) among a set of material file names — bytes have a .meta.json sibling. */
const uploadCount = (names: string[]): number => names.filter((n) => !n.endsWith('.meta.json')).length;

/** Timestamped archive name, e.g. braingain-backup-2026-08-07T14-32-10Z.zip */
function archiveName(kind: 'backup' | 'backups', createdAt: string, suffix = ''): string {
  const stamp = createdAt.replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  return `braingain-${kind}-${stamp}${suffix}.zip`;
}

/** Display name for the bundle of every archive (the route serves this, the service names it). */
export const bundleFileName = (): string => archiveName('backups', new Date().toISOString());

// ── create ───────────────────────────────────────────────────────────────────────────────────────

/** Build the archive bytes for the current data dir (allowlist only). */
async function buildArchive(): Promise<{ bytes: Buffer; contents: BackupMeta['contents'] }> {
  const zip = new JSZip();
  const files: string[] = [];
  const raw: Partial<Record<StoreFile, string>> = {};

  for (const name of STORE_FILES) {
    let text: string;
    try {
      text = await fs.readFile(storeFilePath(name), 'utf-8');
    } catch {
      continue; // a store the app hasn't created yet is simply absent from the archive
    }
    raw[name] = text;
    files.push(`${name}.json`);
    zip.file(`data/${name}.json`, text);
  }

  const mats = await listMaterialFiles();
  for (const entry of mats) {
    // STORE, not DEFLATE: material bytes are usually already-compressed documents, so deflating them
    // burns CPU for no gain. The JSON stores below still get the (large) benefit of DEFLATE.
    zip.file(`${MATERIALS_PREFIX}${entry}`, await fs.readFile(materialFilePath(entry)), { compression: 'STORE' });
  }

  // SCORM package trees, ORIGINAL relative paths preserved (unlike materials these cannot be
  // flattened — an SCO resolves its assets relatively). STORE: course assets are mostly
  // already-compressed media. Attempt files are JSON and deflate well.
  const scormDirs = await listScormPackageDirs();
  for (const pkgId of scormDirs) {
    for (const rel of await listScormEntries(pkgId)) {
      zip.file(`${SCORM_PREFIX}${pkgId}/${rel}`, await fs.readFile(path.join(scormPackageDir(pkgId), ...rel.split('/'))), {
        compression: 'STORE',
      });
    }
  }
  for (const name of await listScormAttemptFiles()) {
    const id = name.replace(/\.json$/, '');
    zip.file(`${SCORM_ATTEMPTS_PREFIX}${name}`, await fs.readFile(scormAttemptPath(id), 'utf-8'));
  }

  // The audit log rides along as evidence. It goes into the manifest's own `audit` field, NOT into
  // `files`: validateArchive maps every `files` entry against STORE_FILES (and would reject this
  // one), and restoreBackup swaps only `files` stores — so the copy is archived but never restored.
  let audit: string | undefined;
  try {
    zip.file(`data/${path.basename(auditFilePath())}`, await fs.readFile(auditFilePath(), 'utf-8'));
    audit = path.basename(auditFilePath());
  } catch {
    // no audit log yet — simply absent from the archive
  }

  const contents = {
    users: countOf(raw.users),
    trainings: countOf(raw.trainings),
    materials: uploadCount(mats),
    scormPackages: scormDirs.length,
  };

  zip.file(
    MANIFEST,
    JSON.stringify(
      { app: APP, formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString(), files, materials: contents.materials, ...(audit ? { audit } : {}) },
      null,
      2,
    ),
  );

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { bytes, contents };
}

async function writeBackup(bytes: Buffer, source: BackupSource, contents: BackupMeta['contents'], fileName?: string): Promise<BackupMeta> {
  await fs.mkdir(backupsDir(), { recursive: true });
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const meta: BackupMeta = {
    id,
    fileName:
      fileName ??
      archiveName('backup', createdAt, source === 'pre-restore' ? '-pre-restore' : source === 'auto' ? '-auto' : ''),
    createdAt,
    size: bytes.length,
    source,
    contents,
  };
  await fs.writeFile(zipPath(id), bytes);
  await fs.writeFile(metaPath(id), JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

/** Snapshot all app data into a new server-side backup. */
export function createBackup(source: BackupSource = 'manual'): Promise<BackupMeta> {
  return exclusive(async () => {
    const { bytes, contents } = await buildArchive();
    return writeBackup(bytes, source, contents);
  });
}

// ── list / read / delete ─────────────────────────────────────────────────────────────────────────

/** Stored backups, newest first. */
export async function listBackups(): Promise<BackupMeta[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(backupsDir());
  } catch {
    return [];
  }
  const metas = await Promise.all(
    entries.filter((e) => e.endsWith('.meta.json')).map((e) => readJson<BackupMeta>(path.join(backupsDir(), e))),
  );
  return metas
    .filter((m): m is BackupMeta => Boolean(m?.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readBackup(id: string): Promise<{ bytes: Buffer; meta: BackupMeta } | null> {
  const meta = await readJson<BackupMeta>(metaPath(id));
  if (!meta) return null;
  try {
    return { bytes: await fs.readFile(zipPath(id)), meta };
  } catch {
    return null;
  }
}

/** True when the backup existed and was removed. */
export async function deleteBackup(id: string): Promise<boolean> {
  const meta = await readJson<BackupMeta>(metaPath(id));
  if (!meta) return false;
  await Promise.allSettled([fs.rm(zipPath(id), { force: true }), fs.rm(metaPath(id), { force: true })]);
  return true;
}

/** One ZIP containing every stored backup archive, named by its display name. */
export async function bundleAll(): Promise<{ bytes: Buffer; count: number; fileName: string }> {
  const zip = new JSZip();
  let count = 0;
  for (const meta of await listBackups()) {
    // The descriptor is already in hand from listBackups — only the archive bytes are still needed.
    const bytes = await fs.readFile(zipPath(meta.id)).catch(() => null);
    if (!bytes) continue; // the archive vanished between listing and reading
    zip.file(meta.fileName, bytes, { compression: 'STORE' }); // entries are already deflated
    count += 1;
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  return { bytes, count, fileName: bundleFileName() };
}

// ── validate / upload ────────────────────────────────────────────────────────────────────────────

interface ValidArchive {
  zip: JSZip;
  /** Store file name → its text, already read and parsed once during validation. */
  stores: { name: string; text: string }[];
  contents: BackupMeta['contents'];
}

/**
 * Parse and fully validate archive bytes. Throws {@link BackupError} unless the ZIP carries a BrainGain
 * manifest and every store it claims is present and parses as JSON — so a foreign or truncated archive
 * is rejected before any restore writes anything. Returns the store texts it read, so a caller does not
 * decompress them a second time.
 */
export async function validateArchive(bytes: Buffer): Promise<ValidArchive> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new BackupError('Not a readable ZIP archive');
  }

  const manifestRaw = await zip.file(MANIFEST)?.async('string');
  if (!manifestRaw) throw new BackupError('Not a BrainGain backup (no manifest.json)');
  let manifest: { app?: string; files?: unknown };
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new BackupError('The backup manifest is not valid JSON');
  }
  if (manifest.app !== APP) throw new BackupError(`Not a ${APP} backup (manifest says "${String(manifest.app ?? '')}")`);

  const claimed = Array.isArray(manifest.files) ? manifest.files.filter((f): f is string => typeof f === 'string') : [];
  if (!claimed.length) throw new BackupError('The backup manifest lists no data files');

  const stores: { name: string; text: string }[] = [];
  const counts: Partial<Record<string, number>> = {};
  for (const file of claimed) {
    const name = path.posix.basename(file); // never trust a path from the archive
    const store = name.replace(/\.json$/, '');
    if (!(STORE_FILES as readonly string[]).includes(store)) {
      throw new BackupError(`The backup lists an unknown data file: ${name}`);
    }
    const text = await zip.file(`data/${name}`)?.async('string');
    if (text === undefined) throw new BackupError(`The backup is incomplete: data/${name} is missing`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BackupError(`The backup is corrupt: data/${name} is not valid JSON`);
    }
    counts[store] = Array.isArray(parsed) ? parsed.length : 0;
    stores.push({ name, text });
  }

  return {
    zip,
    stores,
    contents: {
      users: counts.users ?? 0,
      trainings: counts.trainings ?? 0,
      materials: uploadCount(zipMaterials(zip).map((m) => m.base)),
      scormPackages: new Set(zipScormEntries(zip).map((e) => e.pkgId)).size,
    },
  };
}

/** Validate an uploaded archive and, only if it is usable, store it as a backup. */
export function storeUploadedBackup(bytes: Buffer, fileName: string): Promise<BackupMeta> {
  return exclusive(async () => {
    const { contents } = await validateArchive(bytes);
    const safeName = /\.zip$/i.test(fileName) ? fileName : `${fileName}.zip`;
    return writeBackup(bytes, 'upload', contents, safeName);
  });
}

// ── restore ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Replace ALL app data with the contents of a stored backup. Takes an automatic pre-restore backup
 * first (so a wrong restore is undoable), stages every store, then swaps — data/tls/ and data/backups/
 * are outside the allowlist and are left untouched.
 */
export function restoreBackup(id: string): Promise<{ meta: BackupMeta; safetyBackupId: string; files: string[]; materials: number }> {
  return exclusive(async () => {
    const stored = await readBackup(id);
    if (!stored) throw new BackupNotFound();

    // Validate BEFORE touching anything on disk — a throw from here leaves the dataset untouched.
    const { zip, stores, contents } = await validateArchive(stored.bytes);

    // Undo point for the state we are about to overwrite.
    const snapshot = await buildArchive();
    const safety = await writeBackup(snapshot.bytes, 'pre-restore', snapshot.contents);

    // Past this point the dataset is being modified; a failure carries the snapshot id back so the
    // administrator can recover.
    try {
      const dir = dataDir();
      const staging = path.join(dir, STAGING_DIR_NAME);
      await fs.rm(staging, { recursive: true, force: true });
      await fs.mkdir(staging, { recursive: true });

      // 1. Stage every store from the text validation already decompressed. Only `stores` (the
      //    manifest's `files`) are staged and swapped — data/audit.ndjson in the archive is
      //    INTENTIONALLY never extracted; the local audit trail survives every restore.
      for (const { name, text } of stores) {
        await fs.writeFile(path.join(staging, name), text, 'utf-8');
      }

      // 2. Swap the stores into place — a rename per file, which is atomic per store.
      for (const { name } of stores) {
        await renameWithRetry(path.join(staging, name), path.join(dir, name));
      }

      // 3. Reconcile the materials directory in place: write what the archive holds, then drop what it
      //    doesn't. Deliberately no directory rename — on Windows that intermittently fails with EPERM
      //    when a scanner holds the directory. Material files are content-addressed by UUID, so writing
      //    over an existing id is idempotent and safe to repeat.
      const materials = zipMaterials(zip);
      await fs.mkdir(path.join(dir, 'materials'), { recursive: true });
      for (const { base, entry } of materials) {
        await fs.writeFile(materialFilePath(base), await entry.async('nodebuffer'));
      }
      const wanted = new Set(materials.map((m) => m.base));
      for (const existing of await listMaterialFiles()) {
        if (!wanted.has(existing)) await fs.rm(materialFilePath(existing), { force: true });
      }

      // 3b. SCORM package trees, same write-then-prune shape — but with GUARDED nested paths
      //     (zipScormEntries already dropped anything that fails UUID/containment checks; entries
      //     are content-addressed by package id, so overwriting is idempotent).
      const scormEntries = zipScormEntries(zip);
      for (const { pkgId, rel, entry } of scormEntries) {
        const abs = resolveScormEntry(pkgId, rel)!; // non-null: filtered above
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, await entry.async('nodebuffer'));
      }
      const wantedPkgs = new Set(scormEntries.map((e) => e.pkgId));
      for (const existing of await listScormPackageDirs()) {
        if (!wantedPkgs.has(existing)) {
          await fs.rm(scormPackageDir(existing), { recursive: true, force: true });
        }
      }

      // 3c. SCORM attempt files (flat, UUID-named — the same shape as materials).
      const attempts = zipScormAttempts(zip);
      if (attempts.length) await fs.mkdir(path.dirname(scormAttemptPath(attempts[0].id)), { recursive: true });
      for (const { id, entry } of attempts) {
        await fs.writeFile(scormAttemptPath(id), await entry.async('nodebuffer'));
      }
      const wantedAttempts = new Set(attempts.map((a) => `${a.id}.json`));
      for (const existing of await listScormAttemptFiles()) {
        if (!wantedAttempts.has(existing)) {
          await fs.rm(scormAttemptPath(existing.replace(/\.json$/, '')), { force: true });
        }
      }

      // 4. Clean up.
      await fs.rm(staging, { recursive: true, force: true });
    } catch (err) {
      throw new RestoreFailed(
        `The restore did not complete. Recover with the pre-restore backup ${safety.fileName}.`,
        safety.id,
        err,
      );
    }

    return { meta: stored.meta, safetyBackupId: safety.id, files: stores.map((s) => s.name), materials: contents.materials };
  });
}

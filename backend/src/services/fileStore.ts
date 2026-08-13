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
export const ARRAY_FILES = ['users', 'roles', 'trainings', 'sessions', 'orgUnits'] as const;
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

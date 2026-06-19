import { promises as fs } from 'fs';
import path from 'path';
import type { Settings } from '../types';

// Defaults to backend/src/data; override with DATA_DIR (used by the automated test harness to
// run against an isolated, throwaway data directory).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');

type ArrayFile = 'users' | 'roles' | 'trainings' | 'sessions' | 'orgUnits';

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
  companyName: 'PTW Dosimetry',
  entra: { enabled: false, tenantId: '', clientId: '', allowedDomains: [] },
  tls: null,
  smtp: { enabled: false, host: '', port: 587, secure: false, username: '', password: '', fromName: '', fromAddress: '' },
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

import { promises as fs } from 'fs';
import path from 'path';
import type { Settings } from '../types';

const DATA_DIR = path.join(__dirname, '..', 'data');

type ArrayFile = 'users' | 'roles' | 'trainings' | 'sessions';

function filePath(name: string): string {
  return path.join(DATA_DIR, `${name}.json`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
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

const DEFAULT_SETTINGS: Settings = { passThreshold: 0.8 };

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

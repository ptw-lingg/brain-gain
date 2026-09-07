// The data-version marker: DATA_DIR/_meta.json records which app version's SHAPE the stored data is
// in. It is the one input to the version gate in migrations.ts — the stores themselves are bare JSON
// arrays with nowhere to carry a version.
//
// It is deliberately NOT one of fileStore's STORE_FILES: those are the restore swap set, and a marker
// that got swapped along with the data — or, worse, NOT swapped while the data was — would lie about
// the shape on disk. Instead backup.ts archives it as a read-only passenger (like the audit log) and
// the restore writes it explicitly from the archive's manifest before migrations re-run.
//
// initDataVersion() runs BEFORE seed(): seed() materializes settings.json, which would make a virgin
// directory look populated. A directory with stores but no marker predates versioning and is adopted
// at BASELINE_DATA_VERSION; a fresh directory is stamped at the running version so the historical
// steps never touch freshly-seeded, current-shape data. A marker that exists but is unusable is
// reported and treated as absent — a corrupt 40-byte file must never stop the server.

import { existsSync, promises as fs } from 'fs';
import { appVersion, BASELINE_DATA_VERSION, isValidVersion } from './appVersion';
import { dataMetaFilePath, STORE_FILES, storeFilePath, writeJsonAtomic } from './fileStore';

export type DataMetaAction = 'initialized' | 'adopted' | 'migrated' | 'upgraded' | 'restored';

export interface DataMetaHistoryEntry {
  version: string;
  at: string; // ISO 8601
  action: DataMetaAction;
  changed?: boolean; // migrated: whether the step actually rewrote anything
  note?: string;
}

export interface DataMeta {
  app: 'BrainGain';
  dataVersion: string; // the shape the data is in — the gate input
  appVersion: string; // the app that last wrote this directory (informational)
  migratedAt: string;
  history: DataMetaHistoryEntry[]; // oldest first, capped
}

const HISTORY_CAP = 50;

/** Stored data is newer than the running app → boot refuses (index.ts exits 1) unless overridden. */
export class DataVersionError extends Error {
  constructor(
    readonly dataVersion: string,
    readonly appVersion: string,
  ) {
    super(
      `Data version ${dataVersion} is newer than app version ${appVersion}. Refusing to start so an older ` +
        `build cannot drop fields it does not know about. Upgrade the app, restore a backup taken by version ` +
        `${appVersion} or earlier, or set ALLOW_DATA_DOWNGRADE=1 to override in an emergency.`,
    );
    this.name = 'DataVersionError';
  }
}

/** The marker, or null when absent. An unusable marker is reported and treated as absent. */
export async function readDataMeta(): Promise<DataMeta | null> {
  let raw: string;
  try {
    raw = await fs.readFile(dataMetaFilePath(), 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DataMeta>;
    if (!isValidVersion(parsed.dataVersion)) {
      throw new Error(`dataVersion "${String(parsed.dataVersion)}" is not MAJOR.MINOR.PATCH`);
    }
    return {
      app: 'BrainGain',
      dataVersion: parsed.dataVersion,
      appVersion: isValidVersion(parsed.appVersion) ? parsed.appVersion : parsed.dataVersion,
      migratedAt: typeof parsed.migratedAt === 'string' ? parsed.migratedAt : '',
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch (err: unknown) {
    console.warn(
      `⚠  ${dataMetaFilePath()} is unusable (${(err as Error).message}) — treating the data directory as unmarked.`,
    );
    return null;
  }
}

/** Set dataVersion and append a history entry; the running app is recorded as the writer. Atomic. */
export async function stampDataVersion(
  version: string,
  action: DataMetaAction,
  extra: { note?: string; changed?: boolean } = {},
): Promise<DataMeta> {
  const prev = await readDataMeta();
  const at = new Date().toISOString();
  const entry: DataMetaHistoryEntry = {
    version,
    at,
    action,
    ...(extra.changed !== undefined ? { changed: extra.changed } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
  const meta: DataMeta = {
    app: 'BrainGain',
    dataVersion: version,
    appVersion: appVersion(),
    migratedAt: at,
    history: [...(prev?.history ?? []), entry].slice(-HISTORY_CAP),
  };
  await writeJsonAtomic(dataMetaFilePath(), meta, true);
  return meta;
}

/**
 * Make sure the data directory carries a marker. Existing marker → kept. No marker and no store on
 * disk → fresh install, stamped at the app version. No marker but stores present → an installation
 * that predates versioning, adopted at the baseline (so the steps since then run at this boot).
 */
export async function initDataVersion(): Promise<DataMeta> {
  const existing = await readDataMeta();
  if (existing) return existing;

  const populated = STORE_FILES.some((f) => existsSync(storeFilePath(f)));
  if (!populated) {
    const meta = await stampDataVersion(appVersion(), 'initialized', { note: 'fresh data directory' });
    console.log(`📌 fresh data directory stamped at ${meta.dataVersion}`);
    return meta;
  }
  const meta = await stampDataVersion(BASELINE_DATA_VERSION, 'adopted', {
    note: 'existing data directory adopted at the versioning baseline',
  });
  console.log(`📌 existing data directory adopted at the versioning baseline ${BASELINE_DATA_VERSION}`);
  return meta;
}

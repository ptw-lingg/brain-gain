// The app's semantic version, and the comparator the data-version gate (migrations.ts) runs on.
//
// The single source of truth is the root VERSION file — tools/sync-version.mjs copies it into the
// package descriptors and the requirements catalog, and the SBOMs pick it up from there. It is read
// with readFileSync, never imported: it sits outside tsconfig's rootDir (and so would a JSON import of
// package.json). Strict MAJOR.MINOR.PATCH only. The strictness is deliberately asymmetric: a
// malformed APP version is a deploy error and throws at first use, while a malformed STORED version is
// tolerated by dataVersion.ts — never brick a data directory over a 40-byte file.
//
// tools/version.mjs is the ESM twin of this comparator for the release tooling. The backend compiles
// to CommonJS and cannot import it, so backend/tests/versioning.test.mjs pins the two to one answer.

import { readFileSync } from 'fs';
import path from 'path';

export const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * The data shape every installation had before versioning existed — what a data directory without a
 * marker is adopted as. The last version this codebase called itself (requirements meta.version), and
 * every field install had the shape-normalizing pass applied at every boot, so its shape IS 1.2.0.
 */
export const BASELINE_DATA_VERSION = '1.2.0';

export function isValidVersion(v: unknown): v is string {
  return typeof v === 'string' && VERSION_RE.test(v);
}

/** [major, minor, patch] — throws on anything that is not strict MAJOR.MINOR.PATCH. */
export function parseVersion(v: string): [number, number, number] {
  const m = VERSION_RE.exec(v.trim());
  if (!m) throw new Error(`not a MAJOR.MINOR.PATCH version: "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 / 0 / 1 like a sort comparator. Throws on a malformed input — validate stored values first. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

let cached: string | undefined;

/** The running app's version: the root VERSION file, else backend/package.json. Memoized. */
export function appVersion(): string {
  if (cached) return cached;
  // __dirname is backend/src/services under tsx and backend/dist/services after tsc — the repo root
  // is three levels up either way, and backend/ is two.
  const versionFile = path.join(__dirname, '..', '..', '..', 'VERSION');
  const pkgFile = path.join(__dirname, '..', '..', 'package.json');
  let raw: string;
  let source = versionFile;
  try {
    raw = readFileSync(versionFile, 'utf-8').trim();
  } catch {
    source = pkgFile;
    raw = String((JSON.parse(readFileSync(pkgFile, 'utf-8')) as { version?: unknown }).version ?? '');
  }
  if (!isValidVersion(raw)) {
    throw new Error(`The app version in ${source} must be MAJOR.MINOR.PATCH, got "${raw}"`);
  }
  cached = raw;
  return raw;
}

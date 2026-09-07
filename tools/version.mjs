// Semantic-version helpers for the release tooling (tools/sync-version.mjs, the /release skill).
//
// Strict MAJOR.MINOR.PATCH only — no prerelease or build metadata. The backend keeps its own copy of
// the comparator in backend/src/services/appVersion.ts: its TypeScript compiles to CommonJS and cannot
// import this ESM file, and tsconfig's rootDir forbids compiling anything outside backend/src.
// backend/tests/versioning.test.mjs pins the two copies to the same answer.

export const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function isValidVersion(v) {
  return typeof v === 'string' && VERSION_RE.test(v);
}

/** [major, minor, patch] — throws on anything that is not strict MAJOR.MINOR.PATCH. */
export function parseVersion(v) {
  const m = VERSION_RE.exec(String(v).trim());
  if (!m) throw new Error(`not a MAJOR.MINOR.PATCH version: "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** -1 / 0 / 1 like a sort comparator. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** The next version for a bump kind: 1.2.3 → major 2.0.0 · minor 1.3.0 · patch 1.2.4. */
export function bump(v, kind) {
  const [major, minor, patch] = parseVersion(v);
  switch (kind) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`unknown bump kind: ${kind} (major | minor | patch)`);
  }
}

// Shared helpers for the requirements tooling: parse test files into test-case objects, and derive
// a stable id from a test name. Used by build.mjs (static catalog) and sync-tests.mjs (results).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

// Requirement / VT id tokens that appear inside test names (e.g. "SYS-AUTH-01 / VT-001: …").
export const ID_RE = /\b(SYS-[A-Z]+-\d{2}|SR-\d{3}|VT-(?:[A-Z]\d{2}|\d{3}))\b/g;

// Matches `test('…')`, `test("…")`, `test(`…`)` (not test.describe/beforeEach). Captures the title.
const TEST_CALL = /\btest\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const unescapeName = (s) => s.replace(/\\(['"`\\])/g, '$1');

// Stable id from the (unescaped) test name. The same name → same id in the catalog and in results,
// so results map onto catalog cases without needing the file from the test reporter.
export const idForTest = (name) => 'TC-' + createHash('sha1').update(name).digest('hex').slice(0, 10);

const coversOf = (name) => [...new Set([...name.matchAll(ID_RE)].map((m) => m[1]))];

/** Statically parse a test directory into automated test-case objects (no execution). */
export function parseSuite(dir, pred, kind, repoRoot) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter(pred)) {
    const file = relative(repoRoot, join(dir, f)).replace(/\\/g, '/');
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(TEST_CALL)) {
      const name = unescapeName(m[2]);
      out.push({ id: idForTest(name), name, kind, file, covers: coversOf(name) });
    }
  }
  return out;
}

/** All automated test cases across the backend and e2e suites, deduped by id. */
export function automatedTestCases(repoRoot) {
  const all = [
    ...parseSuite(join(repoRoot, 'backend', 'tests'), (f) => f.endsWith('.test.mjs'), 'backend', repoRoot),
    ...parseSuite(join(repoRoot, 'frontend', 'e2e'), (f) => f.endsWith('.spec.ts'), 'e2e', repoRoot),
  ];
  const byId = new Map();
  for (const tc of all) if (!byId.has(tc.id)) byId.set(tc.id, tc);
  return [...byId.values()];
}

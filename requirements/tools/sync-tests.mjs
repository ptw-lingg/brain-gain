#!/usr/bin/env node
// Run the test suites and embed per-test results into requirements.json under `testRun`.
//
//   node requirements/tools/sync-tests.mjs
//
// requirements.json is the single file handed off to the VeriTrace viewer, so live results travel with
// it. The viewer and the V&V document merge these results onto the test-case catalog by id. Mapping is
// by test NAME → idForTest(name), the same id the catalog uses, so no test reporter file paths are
// needed. build.mjs passes the `testRun` block through unchanged, so `--check` stays a clean drift gate.
//
// Fails (exit 1) WITHOUT writing when a suite fails to launch or produces no results, when a test name
// is not in the catalog (run build.mjs first), or when a catalog case has no result — a partial run
// must never masquerade as a green one. Test failures still write (the embedded results carry the
// failure) but exit 1.
//
// NOTE: this file is maintained as an identical copy in the brain-gain and veri-trace repos
// (drift-check.mjs enforces that) — keep it repo-agnostic.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { idForTest } from './testlib.mjs';
import { serialize } from './serialize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const reqDir = join(here, '..');
const repoRoot = join(reqDir, '..');
const dataPath = join(reqDir, 'requirements.json');

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const catalog = new Map(
  (data.testCases ?? []).filter((c) => c.kind !== 'manual').map((c) => [c.id, c]),
);
const expected = { backend: 0, e2e: 0 };
for (const c of catalog.values()) expected[c.kind] = (expected[c.kind] ?? 0) + 1;

const fail = (msg) => {
  console.error(`[sync-tests] ✗ ${msg}`);
  process.exit(1);
};
const tail = (s) => (s ? `\n${String(s).slice(-2000)}` : '');

const results = {}; // testCaseId -> 'pass' | 'fail' | 'skip'
const kindIds = { backend: new Set(), e2e: new Set() };
const unknown = []; // test-looking names with no catalog entry → the catalog is stale
// Per-file TAP summary entries are expected at the top level and silently ignored.
const isFileEntry = (name) => /[\\/]/.test(name) || /\.(test\.mjs|spec\.ts)$/.test(name);
const record = (name, status, kind) => {
  const id = idForTest(name);
  if (!catalog.has(id)) {
    if (!isFileEntry(name)) unknown.push(`${kind}: ${name}`);
    return;
  }
  if (id in results) console.warn(`[sync-tests] ⚠ duplicate test title (results collide): ${name}`);
  results[id] = status;
  kindIds[kind].add(id);
};

// ── backend: node:test TAP ─────────────────────────────────────────────────────────────────────
console.log('[sync-tests] running backend suite…');
const be = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap'], {
  cwd: join(repoRoot, 'backend'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
if (be.error) fail(`backend suite failed to launch: ${be.error.message}`);
for (const line of (be.stdout || '').split('\n')) {
  const m = /^(ok|not ok)\s+\d+\s+-\s+(.*)$/.exec(line);
  if (!m) continue;
  let name = m[2];
  let status = m[1] === 'ok' ? 'pass' : 'fail';
  // Strip only a real trailing TAP directive — a " # " inside a test name must not corrupt the id.
  const dir = /\s+#\s+(SKIP|TODO)\b.*$/i.exec(name);
  if (dir) { status = 'skip'; name = name.slice(0, dir.index); }
  record(name.trim(), status, 'backend');
}
if (expected.backend && !kindIds.backend.size)
  fail(`backend suite produced no results (exit ${be.status ?? 'null'})${tail(be.stderr)}`);

// ── e2e: Playwright JSON report (written to a temp file to avoid mixing with build logs) ─────────
console.log('[sync-tests] running e2e suite (builds the SPA)…');
const project = String(data.meta?.project ?? 'requirements').toLowerCase();
const reportPath = join(tmpdir(), `${project}-e2e-report-${process.pid}.json`);
const fe = spawnSync('npx', ['playwright', 'test', '--reporter=json'], {
  cwd: join(repoRoot, 'frontend'), encoding: 'utf8', shell: true, maxBuffer: 128 * 1024 * 1024,
  env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
});
if (fe.error) fail(`e2e suite failed to launch: ${fe.error.message}`);
let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (e) {
  fail(`could not read Playwright JSON report (exit ${fe.status ?? 'null'}): ${e.message}${tail(fe.stderr)}`);
}
const walk = (suites) => {
  for (const s of suites ?? []) {
    for (const spec of s.specs ?? []) {
      const statuses = (spec.tests ?? []).flatMap((t) => (t.results ?? []).map((r) => r.status));
      const status = statuses.length && statuses.every((x) => x === 'skipped') ? 'skip' : spec.ok ? 'pass' : 'fail';
      record(spec.title, status, 'e2e');
    }
    walk(s.suites);
  }
};
walk(report.suites);
rmSync(reportPath, { force: true });
if (expected.e2e && !kindIds.e2e.size)
  fail(`e2e suite produced no results (exit ${fe.status ?? 'null'})${tail(fe.stderr)}`);

// ── completeness gates: the embedded run must cover the catalog exactly ──────────────────────────
if (unknown.length) {
  for (const n of unknown) console.error(`[sync-tests]   unknown test (not in catalog): ${n}`);
  fail(`${unknown.length} test(s) missing from the catalog — run build.mjs, then sync-tests again`);
}
const missing = [...catalog.keys()].filter((id) => !(id in results));
if (missing.length) {
  for (const id of missing) console.error(`[sync-tests]   no result for ${id} (${catalog.get(id).name})`);
  fail(`${missing.length} catalog case(s) produced no result — partial run not embedded`);
}

const vals = Object.values(results);
const summary = {
  total: vals.length,
  passed: vals.filter((x) => x === 'pass').length,
  failed: vals.filter((x) => x === 'fail').length,
  skipped: vals.filter((x) => x === 'skip').length,
  backend: kindIds.backend.size,
  e2e: kindIds.e2e.size,
};
data.testRun = { ranAt: new Date().toISOString(), summary, results };
writeFileSync(dataPath, serialize(data), 'utf8');
console.log(`[sync-tests] ${summary.passed} pass / ${summary.failed} fail / ${summary.skipped} skip across ${summary.total} cases (backend ${summary.backend}, e2e ${summary.e2e})`);
console.log(`[sync-tests] embedded results in ${dataPath.replace(repoRoot, '.')}`);
if (summary.failed) process.exitCode = 1;

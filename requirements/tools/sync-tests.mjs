#!/usr/bin/env node
// Run the test suites and record per-test results to frontend/src/data/test-results.generated.json.
//
//   node requirements/tools/sync-tests.mjs
//
// Results are dynamic, so they live in a SEPARATE generated file (not requirements.json, which stays
// deterministic for build.mjs --check). The in-app Requirements view and the V&V document merge these
// results onto the test-case catalog by id. Mapping is by test NAME → idForTest(name), the same id the
// catalog uses, so no test reporter file paths are needed.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { idForTest } from './testlib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const reqDir = join(here, '..');
const repoRoot = join(reqDir, '..');
const outPath = join(repoRoot, 'frontend', 'src', 'data', 'test-results.generated.json');

const data = JSON.parse(readFileSync(join(reqDir, 'requirements.json'), 'utf8'));
const catalog = new Set((data.testCases ?? []).filter((c) => c.kind !== 'manual').map((c) => c.id));

const results = {}; // testCaseId -> 'pass' | 'fail' | 'skip'
const counts = { backend: 0, e2e: 0 };
const record = (name, status, kind) => {
  const id = idForTest(name);
  if (!catalog.has(id)) return; // ignore file-level / unknown TAP entries
  results[id] = status;
  counts[kind]++;
};

// ── backend: node:test TAP ─────────────────────────────────────────────────────────────────────
console.log('[sync-tests] running backend suite…');
const be = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap'], {
  cwd: join(repoRoot, 'backend'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
for (const line of (be.stdout || '').split('\n')) {
  const m = /^(ok|not ok)\s+\d+\s+-\s+(.*)$/.exec(line);
  if (!m) continue;
  let name = m[2];
  let status = m[1] === 'ok' ? 'pass' : 'fail';
  const dir = / # (SKIP|TODO)\b/i.exec(name);
  if (dir) { status = 'skip'; }
  name = name.replace(/\s+# .*$/, '').trim(); // strip any TAP directive
  record(name, status, 'backend');
}

// ── e2e: Playwright JSON report (written to a temp file to avoid mixing with build logs) ─────────
console.log('[sync-tests] running e2e suite (builds the internal SPA)…');
const reportPath = join(tmpdir(), `bg-e2e-report-${process.pid}.json`);
spawnSync('npx', ['playwright', 'test', '--reporter=json'], {
  cwd: join(repoRoot, 'frontend'), encoding: 'utf8', shell: true, maxBuffer: 128 * 1024 * 1024,
  env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
});
try {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
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
} catch (e) {
  console.error('[sync-tests] could not read Playwright JSON report:', e.message);
}

const vals = Object.values(results);
const summary = {
  total: vals.length,
  passed: vals.filter((x) => x === 'pass').length,
  failed: vals.filter((x) => x === 'fail').length,
  skipped: vals.filter((x) => x === 'skip').length,
  backend: counts.backend,
  e2e: counts.e2e,
};
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), summary, results }, null, 2) + '\n');
console.log(`[sync-tests] ${summary.passed} pass / ${summary.failed} fail / ${summary.skipped} skip across ${summary.total} cases (backend ${counts.backend}, e2e ${counts.e2e})`);
console.log(`[sync-tests] wrote ${outPath.replace(repoRoot, '.')}`);
if (summary.failed) process.exitCode = 1;

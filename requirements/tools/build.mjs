#!/usr/bin/env node
// Validate requirements.json, build the test-case catalog + coverage, and sync the app's data copy.
//
//   node requirements/tools/build.mjs           # validate + rebuild testCases/coverage + write JSON
//   node requirements/tools/build.mjs --check    # validate + fail if JSON is out of date (CI / pre-commit)
//
// requirements.json is the single source of truth AND the single file handed off to the VeriTrace
// viewer app. This tool:
//   1. statically parses the backend + e2e suites into `testCases[]` (kind backend|e2e), preserving any
//      authored manual test cases (kind manual) for checks automation can't reach,
//   2. computes `meta.coverage` from `testCases[].covers` (+ self-documented usability/accessibility VTs).
// Live pass/fail results are embedded by sync-tests.mjs under `testRun`; this tool passes any existing
// `testRun` block through unchanged, so the file stays deterministic and `--check` works as a CI drift
// gate. No separate generated copy and no Markdown views are emitted.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { automatedTestCases } from './testlib.mjs';
import { serialize } from './serialize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const reqDir = join(here, '..');
const repoRoot = join(reqDir, '..');
const dataPath = join(reqDir, 'requirements.json');
const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');
const CHECK = process.argv.includes('--check');

const data = JSON.parse(readFileSync(dataPath, 'utf8'));

// ───────────────────────────── 1. test-case catalog (manual authored + automated parsed) ─────────────────────────────
const manualCases = (data.testCases ?? []).filter((tc) => tc.kind === 'manual');
const automated = automatedTestCases(repoRoot);
data.testCases = [...manualCases, ...automated].sort((a, b) => a.id.localeCompare(b.id));

// id → set of test kinds covering it
const coverKinds = new Map();
for (const tc of data.testCases)
  for (const id of tc.covers ?? []) (coverKinds.get(id) ?? coverKinds.set(id, new Set()).get(id)).add(tc.kind);

// A usability/accessibility (or inspection-method) VT is its own self-documented manual test.
const selfManual = (t) => ['usability', 'accessibility'].includes(t.testType) || ['manual', 'inspection'].includes(t.method);

// VT coverage: kinds of test cases naming the VT, plus 'manual' if the VT is self-documented.
const vtKinds = new Map();
for (const t of data.tests) {
  const kinds = new Set(coverKinds.get(t.id) ?? []);
  if (selfManual(t)) kinds.add('manual');
  vtKinds.set(t.id, kinds);
}
// Stakeholder requirements are validated by their VTs — an SR inherits the coverage of the VTs that
// validate it (the VT is the SR's validation test). System requirements must be named by a test case
// (verification) or an authored manual case; they do not inherit.
const validatingVts = new Map();
for (const t of data.tests)
  for (const l of t.links ?? []) if (l.type === 'validates') (validatingVts.get(l.target) ?? validatingVts.set(l.target, []).get(l.target)).push(t.id);

function kindsFor(r) {
  const kinds = new Set(coverKinds.get(r.id) ?? []);
  if (r.type === 'stakeholder') for (const vt of validatingVts.get(r.id) ?? []) for (const k of vtKinds.get(vt) ?? []) kinds.add(k);
  return kinds;
}

const cov = { total: 0, covered: 0, backend: 0, e2e: 0, manual: 0, gaps: [] };
const tally = (id, kinds) => {
  cov.total++;
  if (kinds.has('backend')) cov.backend++;
  if (kinds.has('e2e')) cov.e2e++;
  if (kinds.has('manual')) cov.manual++;
  if (kinds.size) cov.covered++;
  else cov.gaps.push(id);
};
for (const r of data.requirements) { delete r.testedBy; tally(r.id, kindsFor(r)); }
for (const t of data.tests) {
  delete t.testedBy;
  const kinds = vtKinds.get(t.id);
  t.automated = kinds.has('backend') || kinds.has('e2e');
  tally(t.id, kinds);
}
data.meta.coverage = cov;

// ───────────────────────────── 2. validate ─────────────────────────────
const errors = [];
const err = (m) => errors.push(m);
const ID = /^(SR-\d{3}|SYS-[A-Z]+-\d{2})$/;
const TEST_ID = /^VT-([A-Z]\d{2}|\d{3})$/;
const TC_ID = /^TC-[0-9a-f]{10}$/;
const ids = new Map();
const enumIds = (k) => new Set((data.enums[k] ?? []).map((e) => e.id));
const [pri, src, st, lt] = [enumIds('priority'), enumIds('source'), enumIds('status'), enumIds('linkType')];
const [tt, mt] = [enumIds('testType'), enumIds('method')];

for (const r of data.requirements) {
  if (!ID.test(r.id)) err(`bad id: ${r.id}`);
  if (ids.has(r.id)) err(`duplicate id: ${r.id}`);
  ids.set(r.id, r);
  if (!st.has(r.status)) err(`${r.id}: bad status ${r.status}`);
  for (const l of r.links ?? []) if (!lt.has(l.type)) err(`${r.id}: bad link type ${l.type}`);
  if (r.type === 'stakeholder') {
    if (!pri.has(r.priority)) err(`${r.id}: bad priority`);
    if (!src.has(r.source)) err(`${r.id}: bad source ${r.source}`);
  }
  if (r.type === 'system') {
    if (!(r.links ?? []).some((l) => l.type === 'derivedFrom')) err(`${r.id}: no derivedFrom`);
    if (!(r.implementedBy ?? []).length) err(`${r.id}: no implementedBy`);
  }
}
for (const r of data.requirements) for (const l of r.links ?? []) if (!ids.has(l.target)) err(`${r.id}: dangling link ${l.target}`);
const covered = new Set();
for (const r of data.requirements) if (r.type === 'system') for (const l of r.links ?? []) if (l.type === 'derivedFrom') covered.add(l.target);
for (const r of data.requirements) if (r.type === 'stakeholder' && !covered.has(r.id)) err(`coverage gap: ${r.id} unsatisfied`);
const validated = new Set();
const testIds = new Set();
for (const t of data.tests) {
  if (!TEST_ID.test(t.id)) err(`bad test id: ${t.id}`);
  if (testIds.has(t.id) || ids.has(t.id)) err(`duplicate test id: ${t.id}`);
  testIds.add(t.id);
  if (!tt.has(t.testType)) err(`${t.id}: bad testType`);
  if (!mt.has(t.method)) err(`${t.id}: bad method`);
  if (!(t.links ?? []).some((l) => l.type === 'validates')) err(`${t.id}: no validates link`);
  for (const l of t.links ?? []) {
    const tgt = ids.get(l.target);
    if (!tgt) err(`${t.id}: dangling link ${l.target}`);
    else if (l.type === 'validates' && tgt.type !== 'stakeholder') err(`${t.id}: validates non-stakeholder ${l.target}`);
    if (l.type === 'validates' && tgt) validated.add(l.target);
  }
  if (!(t.steps ?? []).length) err(`${t.id}: no steps`);
  if (!t.expected) err(`${t.id}: no expected`);
}
for (const r of data.requirements) if (r.type === 'stakeholder' && !validated.has(r.id)) err(`validation gap: ${r.id} has no VT`);
// test cases
const known = (id) => ids.has(id) || testIds.has(id);
for (const tc of data.testCases) {
  if (!TC_ID.test(tc.id)) err(`bad testCase id: ${tc.id} (${tc.name})`);
  if (!['backend', 'e2e', 'manual'].includes(tc.kind)) err(`${tc.id}: bad kind ${tc.kind}`);
  if (!(tc.covers ?? []).length) err(`${tc.id}: covers nothing (${tc.name})`);
  for (const c of tc.covers ?? []) if (!known(c)) err(`${tc.id}: covers unknown id ${c}`);
  if (tc.kind === 'manual' && !tc.manual?.expected) err(`${tc.id}: manual case needs manual.expected`);
}

if (errors.length) {
  console.error(`✗ requirements.json failed validation (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

// ───────────────────────────── 3. serialize (shared writer — one object per line, CRLF) ─────────────────────────────
const reqOut = serialize(data); // preserves any existing data.testRun block

if (CHECK) {
  let cur = '';
  try { cur = readFileSync(dataPath, 'utf8'); } catch { /* missing = drift */ }
  if (cur !== reqOut) {
    console.error(`✗ out of date: ${rel(dataPath)} (run build.mjs)`);
    process.exit(1);
  }
  console.log(`✓ up to date — ${data.testCases.length} test cases · coverage ${cov.covered}/${cov.total} (backend ${cov.backend}, e2e ${cov.e2e}, manual ${cov.manual}), gaps ${cov.gaps.length}`);
} else {
  writeFileSync(dataPath, reqOut, 'utf8');
  const sr = data.requirements.filter((r) => r.type === 'stakeholder').length;
  const sys = data.requirements.length - sr;
  console.log(`✓ ${sr} stakeholder + ${sys} system + ${data.tests.length} VT + ${data.testCases.length} test cases`);
  console.log(`  coverage ${cov.covered}/${cov.total} ids — backend ${cov.backend}, e2e ${cov.e2e}, manual ${cov.manual}, gaps ${cov.gaps.length}`);
  console.log(`  wrote ${rel(dataPath)}`);
  if (cov.gaps.length) console.log(`  GAPS: ${cov.gaps.join(', ')}`);
}

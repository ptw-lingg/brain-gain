#!/usr/bin/env node
// Validate requirements.json, inject test+coverage data, and sync the app's data copy.
//
//   node requirements/tools/build.mjs           # validate + inject coverage + write JSON
//   node requirements/tools/build.mjs --check    # validate + fail if JSON is out of date (CI / pre-commit)
//
// requirements.json is the single source of truth. This tool:
//   1. strips dead references to the removed brain-gain.md spec (idempotent),
//   2. scans the test suites and writes each requirement's `testedBy` + each VT's `automated`/`testedBy`,
//      plus a `meta.coverage` summary, INTO requirements.json,
//   3. writes frontend/src/data/requirements.generated.json (the copy the in-app viewer imports).
// It no longer emits the Markdown views (the dataset itself is the artifact).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const reqDir = join(here, '..');
const repoRoot = join(reqDir, '..');
const dataPath = join(reqDir, 'requirements.json');
const generatedPath = join(repoRoot, 'frontend', 'src', 'data', 'requirements.generated.json');
const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');
const CHECK = process.argv.includes('--check');

const data = JSON.parse(readFileSync(dataPath, 'utf8'));

// ───────────────────────────── 1. strip the removed brain-gain.md spec ─────────────────────────────
delete data.meta.specDoc;
for (const r of data.requirements) {
  delete r.specRefs; // every specRef pointed at the now-deleted brain-gain.md
  // SYS-AC-06's only implementedBy was the doc's permission matrix — repoint to the real enforcement.
  if ((r.implementedBy ?? []).some((c) => c.path === 'brain-gain.md')) {
    r.implementedBy = [
      { path: 'backend/src/middleware/auth.ts', symbol: 'requireAdmin/requireTrainerOrAdmin/requireAdminOrOwner' },
      { path: 'backend/src/routes/', symbol: 'per-endpoint guards (users/roles/settings/trainings)' },
    ];
  }
}

// ───────────────────────────── 2. scan test suites → testedBy / coverage ─────────────────────────────
const ID_RE = /\b(SYS-[A-Z]+-\d{2}|SR-\d{3}|VT-(?:[A-Z]\d{2}|\d{3}))\b/g;
function refsFrom(dir, pred, kind) {
  const out = []; // [{ id, kind, file }]
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter(pred)) {
    const seen = new Set();
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(ID_RE)) seen.add(m[1]);
    for (const id of seen) out.push({ id, kind, file: `${rel(dir)}/${f}` });
  }
  return out;
}
const allRefs = [
  ...refsFrom(join(repoRoot, 'backend', 'tests'), (f) => f.endsWith('.test.mjs'), 'backend'),
  ...refsFrom(join(repoRoot, 'frontend', 'e2e'), (f) => f.endsWith('.spec.ts'), 'e2e'),
  ...refsFrom(join(reqDir, 'manual-tests'), (f) => f.endsWith('.md'), 'manual'),
];
const refsById = new Map();
for (const r of allRefs) (refsById.get(r.id) ?? refsById.set(r.id, []).get(r.id)).push({ kind: r.kind, file: r.file });
const testedBy = (id) => (refsById.get(id) ?? []).sort((a, b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file));

// A VT whose method/type is inherently manual is "covered" by its own spec in this dataset.
const selfManual = (t) => ['usability', 'accessibility'].includes(t.testType) || ['manual', 'inspection'].includes(t.method);

// No timestamp here — the file must be deterministic so `--check` works as a CI drift gate.
const cov = { total: 0, covered: 0, backend: 0, e2e: 0, manual: 0, gaps: [] };
const note = (id, by, extraManual) => {
  cov.total++;
  const kinds = new Set(by.map((b) => b.kind));
  if (extraManual) kinds.add('manual');
  if (kinds.has('backend')) cov.backend++;
  if (kinds.has('e2e')) cov.e2e++;
  if (kinds.has('manual')) cov.manual++;
  if (kinds.size) cov.covered++;
  else cov.gaps.push(id);
  return kinds;
};

for (const r of data.requirements) {
  const by = testedBy(r.id);
  if (by.length) r.testedBy = by;
  else delete r.testedBy;
  note(r.id, by, false);
}
for (const t of data.tests) {
  const by = testedBy(t.id);
  const auto = by.some((b) => b.kind === 'backend' || b.kind === 'e2e');
  t.automated = auto;
  if (by.length) t.testedBy = by;
  else delete t.testedBy;
  note(t.id, by, selfManual(t)); // manual VTs count as self-documented
}
data.meta.coverage = cov;

// ───────────────────────────── 3. validate ─────────────────────────────
const errors = [];
const err = (m) => errors.push(m);
const ID = /^(SR-\d{3}|SYS-[A-Z]+-\d{2})$/;
const TEST_ID = /^VT-([A-Z]\d{2}|\d{3})$/;
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

if (errors.length) {
  console.error(`✗ requirements.json failed validation (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

// ───────────────────────────── 4. serialize (one object per line, CRLF — keeps the file greppable) ─────────────────────────────
const NL = '\r\n';
const arr = (key, list, indent) =>
  !list || !list.length
    ? `${indent}"${key}": []`
    : `${indent}"${key}": [${NL}${list.map((o) => `${indent}  ${JSON.stringify(o)}`).join(',' + NL)}${NL}${indent}]`;
const block = (key, obj, indent) => `${indent}"${key}": ${JSON.stringify(obj, null, 2).split('\n').join(NL + indent)}`;

function serialize(d) {
  const parts = [];
  parts.push(`  "$schema": ${JSON.stringify(d.$schema)}`);
  parts.push(block('meta', d.meta, '  '));
  const enumParts = Object.entries(d.enums).map(([k, v]) => arr(k, v, '    '));
  parts.push(`  "enums": {${NL}${enumParts.join(',' + NL)}${NL}  }`);
  parts.push(arr('actors', d.actors, '  '));
  if (d.outOfScope) parts.push(arr('outOfScope', d.outOfScope, '  '));
  parts.push(arr('requirements', d.requirements, '  '));
  parts.push(arr('tests', d.tests, '  '));
  return `{${NL}${parts.join(',' + NL)}${NL}}${NL}`;
}

const reqOut = serialize(data);
const genOut = JSON.stringify(data, null, 2) + '\n';

if (CHECK) {
  let drift = 0;
  for (const [p, body] of [[dataPath, reqOut], [generatedPath, genOut]]) {
    let cur = '';
    try { cur = readFileSync(p, 'utf8'); } catch { /* missing = drift */ }
    if (cur !== body) { drift++; console.error(`✗ out of date: ${rel(p)} (run build.mjs)`); }
  }
  if (drift) process.exit(1);
  console.log(`✓ up to date — coverage ${cov.covered}/${cov.total} (backend ${cov.backend}, e2e ${cov.e2e}, manual ${cov.manual}), gaps ${cov.gaps.length}`);
} else {
  writeFileSync(dataPath, reqOut, 'utf8');
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, genOut, 'utf8');
  const sr = data.requirements.filter((r) => r.type === 'stakeholder').length;
  const sys = data.requirements.length - sr;
  console.log(`✓ ${sr} stakeholder + ${sys} system + ${data.tests.length} tests`);
  console.log(`  coverage ${cov.covered}/${cov.total} ids — backend ${cov.backend}, e2e ${cov.e2e}, manual ${cov.manual}, gaps ${cov.gaps.length}`);
  console.log(`  wrote ${rel(dataPath)} + ${rel(generatedPath)}`);
  if (cov.gaps.length) console.log(`  GAPS: ${cov.gaps.join(', ')}`);
}

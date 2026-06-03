#!/usr/bin/env node
// Validate requirements.json and (re)generate the human-readable Markdown views from it.
//
//   node requirements/tools/build.mjs           # validate + write the Markdown docs
//   node requirements/tools/build.mjs --check    # validate + fail if the docs are out of date (CI / pre-commit)
//
// requirements.json is the single source of truth; the Markdown files below are generated artifacts.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const reqDir = join(here, '..'); // requirements/
const repoRoot = join(reqDir, '..');
const dataPath = join(reqDir, 'requirements.json');
const rel = (p) => relative(repoRoot, p).replace(/\\/g, '/');
const CHECK = process.argv.includes('--check');

const BANNER =
  '<!-- GENERATED FROM requirements.json by requirements/tools/build.mjs — DO NOT EDIT BY HAND -->';

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const reqs = data.requirements;

// ---------------------------------------------------------------- validation
const ID_RE = /^(SR-\d{3}|SYS-[A-Z]+-\d{2})$/;
const priorityIds = new Set(data.enums.priority.map((e) => e.id));
const sourceIds = new Set(data.enums.source.map((e) => e.id));
const statusIds = new Set(data.enums.status.map((e) => e.id));
const linkTypeIds = new Set(data.enums.linkType.map((e) => e.id));
const testTypeIds = new Set((data.enums.testType ?? []).map((e) => e.id));
const methodIds = new Set((data.enums.method ?? []).map((e) => e.id));
const ids = new Map(); // id -> requirement
const testIds = new Set();
const tests = data.tests ?? [];

const errors = [];
const err = (m) => errors.push(m);

for (const r of reqs) {
  if (!ID_RE.test(r.id)) err(`bad id pattern: ${r.id}`);
  if (ids.has(r.id)) err(`duplicate id: ${r.id}`);
  ids.set(r.id, r);
  if (!statusIds.has(r.status)) err(`${r.id}: unknown status "${r.status}"`);
  for (const l of r.links ?? []) {
    if (!linkTypeIds.has(l.type)) err(`${r.id}: unknown link type "${l.type}"`);
  }
  if (r.type === 'stakeholder') {
    if (!priorityIds.has(r.priority)) err(`${r.id}: unknown priority "${r.priority}"`);
    if (!sourceIds.has(r.source)) err(`${r.id}: unknown source "${r.source}"`);
  }
  if (r.type === 'system') {
    const hasDerive = (r.links ?? []).some((l) => l.type === 'derivedFrom');
    if (!hasDerive) err(`${r.id}: system requirement has no derivedFrom link`);
    if (!(r.implementedBy ?? []).length) err(`${r.id}: system requirement has no implementedBy`);
  }
}
// link targets resolve
for (const r of reqs) {
  for (const l of r.links ?? []) {
    if (!ids.has(l.target)) err(`${r.id}: link target not found: ${l.target}`);
  }
}
// every stakeholder requirement is covered by ≥1 system requirement
const covered = new Set();
for (const r of reqs) {
  if (r.type === 'system') for (const l of r.links ?? []) if (l.type === 'derivedFrom') covered.add(l.target);
}
for (const r of reqs) {
  if (r.type === 'stakeholder' && !covered.has(r.id)) err(`coverage gap: ${r.id} has no system requirement`);
}

// --- validation tests (VT-…) ---
const TEST_ID_RE = /^VT-([A-Z]\d{2}|\d{3})$/;
const validated = new Set(); // SR ids that have ≥1 validation test
for (const t of tests) {
  if (!TEST_ID_RE.test(t.id)) err(`bad test id pattern: ${t.id}`);
  if (ids.has(t.id)) err(`test id collides with a requirement id: ${t.id}`);
  if (testIds.has(t.id)) err(`duplicate test id: ${t.id}`);
  testIds.add(t.id);
  if (!testTypeIds.has(t.testType)) err(`${t.id}: unknown testType "${t.testType}"`);
  if (!methodIds.has(t.method)) err(`${t.id}: unknown method "${t.method}"`);
  if (!(t.links ?? []).some((l) => l.type === 'validates')) err(`${t.id}: test has no "validates" link`);
  for (const l of t.links ?? []) {
    const target = ids.get(l.target);
    if (!target) err(`${t.id}: link target not found: ${l.target}`);
    else if (l.type === 'validates' && target.type !== 'stakeholder')
      err(`${t.id}: validates a non-stakeholder requirement (${l.target})`);
    if (l.type === 'validates' && target) validated.add(l.target);
  }
  if (!(t.steps ?? []).length) err(`${t.id}: no steps`);
  if (!t.expected) err(`${t.id}: no expected result`);
}
// every stakeholder requirement must be validated by ≥1 test
for (const r of reqs) {
  if (r.type === 'stakeholder' && !validated.has(r.id)) err(`validation gap: ${r.id} has no validation test`);
}

if (errors.length) {
  console.error(`✗ requirements.json failed validation (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

const sr = reqs.filter((r) => r.type === 'stakeholder');
const sys = reqs.filter((r) => r.type === 'system');
console.log(
  `✓ valid: ${sr.length} stakeholder + ${sys.length} system requirements + ${tests.length} validation tests, ${ids.size + testIds.size} ids, 0 errors`,
);

// ---------------------------------------------------------------- helpers
const label = (list, id) => (list.find((e) => e.id === id)?.label ?? id);
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const code = (s) => '`' + String(s).replace(/\|/g, '\\|') + '`';
const derivedFrom = (r) => (r.links ?? []).filter((l) => l.type === 'derivedFrom').map((l) => l.target);
const orderedCategories = (list) => {
  const seen = [];
  for (const r of list) if (!seen.includes(r.category)) seen.push(r.category);
  return seen;
};
const implRefs = (r) =>
  (r.implementedBy ?? [])
    .map((c) => (c.symbol ? `${code(c.path)} · ${cell(c.symbol)}` : code(c.path)))
    .join('; ');

// ---------------------------------------------------------------- generators
function stakeholderDoc() {
  const out = [];
  out.push('# BrainGain — Stakeholder Requirements', '', BANNER, '');
  out.push(`> Generated from \`requirements.json\` · ${sr.length} requirements · updated ${data.meta.updated}.`, '');
  out.push('Priority: **M** = Must · **S** = Should · **C** = Could.', '');

  out.push('## Actors', '');
  out.push('| ID | Actor | Description |', '|---|---|---|');
  for (const a of data.actors) out.push(`| \`${a.id}\` | ${cell(a.name)} | ${cell(a.description)} |`);
  out.push('');

  out.push('## Requirements', '');
  for (const catName of orderedCategories(sr)) {
    out.push(`### ${catName}`, '');
    out.push('| ID | Requirement | Priority | Source | Status |', '|---|---|---|---|---|');
    for (const r of sr.filter((x) => x.category === catName)) {
      const src = label(data.enums.source, r.source) + (r.sourceNote ? ` (${r.sourceNote})` : '');
      out.push(`| ${r.id} | **${cell(r.title)}** — ${cell(r.text)} | ${r.priority} | ${cell(src)} | ${label(data.enums.status, r.status)} |`);
    }
    out.push('');
  }

  if (data.outOfScope?.length) {
    out.push('## Out of Scope', '');
    for (const o of data.outOfScope) out.push(`- ${cell(o.text)}`);
    out.push('');
  }
  return out.join('\n');
}

function systemDoc() {
  const out = [];
  out.push('# BrainGain — System Requirements', '', BANNER, '');
  out.push(`> Generated from \`requirements.json\` · ${sys.length} requirements · updated ${data.meta.updated}.`, '');
  out.push('Each system requirement is **derived from** one or more stakeholder requirements (`SR-…`).', '');

  for (const catName of orderedCategories(sys)) {
    out.push(`### ${catName}`, '');
    out.push('| ID | Requirement | Derived from | Status |', '|---|---|---|---|');
    for (const r of sys.filter((x) => x.category === catName)) {
      out.push(`| ${r.id} | **${cell(r.title)}** — ${cell(r.text)} | ${derivedFrom(r).join(', ')} | ${label(data.enums.status, r.status)} |`);
    }
    out.push('');
  }

  // coverage by stakeholder category
  out.push('## Coverage (stakeholder area → system requirements)', '');
  out.push('| Stakeholder area | Stakeholder reqs | Covering system reqs |', '|---|---|---|');
  for (const catName of orderedCategories(sr)) {
    const srIds = sr.filter((x) => x.category === catName).map((x) => x.id);
    const sysIds = sys
      .filter((x) => derivedFrom(x).some((d) => srIds.includes(d)))
      .map((x) => x.id);
    out.push(`| ${cell(catName)} | ${srIds.join(', ')} | ${sysIds.join(', ')} |`);
  }
  out.push('');
  return out.join('\n');
}

function traceDoc() {
  const out = [];
  out.push('# BrainGain — Requirements Traceability Matrix', '', BANNER, '');
  out.push(`> Generated from \`requirements.json\` · updated ${data.meta.updated}. Maps every system requirement to`, '> the code that implements it, and back to the stakeholder requirement(s) it satisfies.', '');

  for (const catName of orderedCategories(sys)) {
    out.push(`### ${catName}`, '');
    out.push('| SYS | Implemented by | Derived from | Verified |', '|---|---|---|---|');
    for (const r of sys.filter((x) => x.category === catName)) {
      const verified = (r.verifiedBy ?? []).map((v) => v.method).join(', ') || '—';
      out.push(`| ${r.id} | ${implRefs(r)} | ${derivedFrom(r).join(', ')} | ${cell(verified)} |`);
    }
    out.push('');
  }

  out.push('## Reverse index — stakeholder requirement → system requirements → code', '');
  out.push('| SR | Title | Satisfied by | Code areas |', '|---|---|---|---|');
  for (const s of sr) {
    const covering = sys.filter((x) => derivedFrom(x).includes(s.id));
    const sysIds = covering.map((x) => x.id).join(', ') || '—';
    const paths = [...new Set(covering.flatMap((x) => (x.implementedBy ?? []).map((c) => c.path)))];
    out.push(`| ${s.id} | ${cell(s.title)} | ${sysIds} | ${paths.map(code).join(', ') || '—'} |`);
  }
  out.push('');
  return out.join('\n');
}

const validates = (t) => (t.links ?? []).filter((l) => l.type === 'validates').map((l) => l.target);

function validationDoc() {
  const out = [];
  out.push('# BrainGain — Validation Plan', '', BANNER, '');
  out.push(
    `> Generated from \`requirements.json\` · ${tests.length} validation tests · updated ${data.meta.updated}.`,
    '> Validation answers *"are we building the right thing?"* — each test exercises one or more **stakeholder**',
    '> requirements (`SR-…`), including usability and accessibility.',
    '',
  );
  for (const tt of data.enums.testType) {
    const group = tests.filter((t) => t.testType === tt.id);
    if (!group.length) continue;
    out.push(`## ${tt.label} tests (${group.length})`, '');
    for (const t of group) {
      out.push(`#### ${t.id} — ${t.title}`, '');
      out.push(
        `- **Method:** ${label(data.enums.method, t.method)} · **Validates:** ${validates(t).join(', ')}`,
      );
      if (t.preconditions) out.push(`- **Preconditions:** ${t.preconditions}`);
      out.push('- **Steps:**');
      t.steps.forEach((s, i) => out.push(`  ${i + 1}. ${s}`));
      out.push(`- **Expected:** ${t.expected}`);
      if (t.metric) out.push(`- **Acceptance metric:** ${t.metric}`);
      out.push('');
    }
  }
  out.push('## Coverage (stakeholder requirement → validation tests)', '');
  out.push('| SR | Title | Priority | Validated by |', '|---|---|---|---|');
  for (const s of sr) {
    const ts = tests.filter((t) => validates(t).includes(s.id)).map((t) => t.id);
    out.push(`| ${s.id} | ${cell(s.title)} | ${s.priority} | ${ts.join(', ')} |`);
  }
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------- write / check
const nl = (s) => (s.endsWith('\n') ? s : s + '\n');
const outputs = [
  [join(reqDir, 'stakeholder-requirements.md'), nl(stakeholderDoc())],
  [join(reqDir, 'system-requirements.md'), nl(systemDoc())],
  [join(reqDir, 'traceability-matrix.md'), nl(traceDoc())],
  [join(reqDir, 'validation-plan.md'), nl(validationDoc())],
  // Generated copy the Vue app imports directly (kept in sync by this script).
  [join(repoRoot, 'frontend', 'src', 'data', 'requirements.generated.json'), JSON.stringify(data, null, 2) + '\n'],
];

let drift = 0;
for (const [path, body] of outputs) {
  if (CHECK) {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      /* missing file counts as drift */
    }
    if (current !== body) {
      drift++;
      console.error(`✗ out of date: ${rel(path)} (run build.mjs to regenerate)`);
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
    console.log(`  wrote ${rel(path)}`);
  }
}

if (CHECK && drift) process.exit(1);
if (CHECK) console.log('✓ Generated views are up to date');

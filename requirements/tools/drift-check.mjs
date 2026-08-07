#!/usr/bin/env node
// Guard against drift between the requirements tooling copies in the two sibling repos
// (brain-gain ↔ veri-trace). The tools are maintained as identical files; this check fails when they
// diverge, so a fix in one repo cannot silently miss the other.
//
//   node requirements/tools/drift-check.mjs                 # compares against the sibling checkout
//   PEER_REPO=<path> node requirements/tools/drift-check.mjs
//
// Compares the tool files below (EOL-normalized) and schema/requirements.schema.json with the
// project-specific `$id`/`title` ignored. If no sibling checkout is found the check is skipped
// (warn, exit 0) so a standalone clone still verifies.
//
// NOTE: this file is itself maintained as an identical copy in both repos — keep it repo-agnostic.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(join(here, '..', '..'));

const KNOWN_REPOS = ['brain-gain', 'veri-trace'];
let peer = process.env.PEER_REPO;
if (!peer) {
  const other = KNOWN_REPOS.find((n) => n !== basename(repoRoot).toLowerCase());
  peer = other ? join(repoRoot, '..', other) : '';
}
if (!peer || !existsSync(join(peer, 'requirements', 'tools'))) {
  console.warn(`[drift-check] ⚠ sibling repo not found (looked at ${peer || '<none>'}) — skipped`);
  process.exit(0);
}

const norm = (s) => s.replace(/\r\n/g, '\n');
const TOOLS = ['build.mjs', 'sync-tests.mjs', 'testlib.mjs', 'serialize.mjs', 'drift-check.mjs'];
const diffs = [];
for (const f of TOOLS) {
  const b = join(peer, 'requirements', 'tools', f);
  if (!existsSync(b)) { diffs.push(`tools/${f}: missing in peer`); continue; }
  if (norm(readFileSync(join(here, f), 'utf8')) !== norm(readFileSync(b, 'utf8'))) diffs.push(`tools/${f}: content differs`);
}
// Schema must be identical apart from the project-specific $id/title.
const schemaOf = (root) => {
  const s = JSON.parse(readFileSync(join(root, 'requirements', 'schema', 'requirements.schema.json'), 'utf8'));
  delete s.$id;
  delete s.title;
  return JSON.stringify(s);
};
try {
  if (schemaOf(repoRoot) !== schemaOf(peer)) diffs.push('schema/requirements.schema.json: differs beyond $id/title');
} catch (e) {
  diffs.push(`schema compare failed: ${e.message}`);
}

if (diffs.length) {
  console.error(`[drift-check] ✗ tooling drift vs ${peer}:`);
  for (const d of diffs) console.error('  - ' + d);
  process.exit(1);
}
console.log(`[drift-check] ✓ tools + schema in sync with ${peer}`);

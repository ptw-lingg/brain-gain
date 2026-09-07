#!/usr/bin/env node
// Propagate the root VERSION file — the single source of truth for the app version — into every
// descriptor that repeats it:
//
//   package.json, backend/package.json, frontend/package.json      "version"
//   backend/package-lock.json, frontend/package-lock.json          "version" and packages[""].version
//   requirements/requirements.json                                 meta.version (through the shared serializer,
//                                                                  so build.mjs --check stays byte-identical)
//
//   node tools/sync-version.mjs           # write every descriptor that disagrees
//   node tools/sync-version.mjs --check   # fail (exit 1) if any descriptor disagrees — first step of npm run verify
//
// The backend reads VERSION directly at boot (backend/src/services/appVersion.ts); the SBOMs pick the
// version up from the package.json files, so syncing closes the loop VERSION → descriptors → SBOM.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidVersion } from './version.mjs';
import { serialize } from '../requirements/tools/serialize.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
if (!isValidVersion(version)) {
  console.error(`✗ VERSION must be MAJOR.MINOR.PATCH, got "${version}"`);
  process.exit(1);
}

const drift = [];
const touched = [];

/** Sync one plain JSON descriptor. `current` lists the version values it holds; `apply` rewrites them. */
function syncJson(file, current, apply) {
  const path = join(root, file);
  const raw = readFileSync(path, 'utf8');
  const data = JSON.parse(raw);
  const found = current(data);
  if (found.length && found.every((v) => v === version)) return;
  drift.push(`${file}: ${[...new Set(found.map((v) => v ?? '(missing)'))].join(', ')}`);
  if (CHECK) return;
  apply(data);
  // Preserve the file's own line endings and trailing newline so only the version lines move.
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let out = JSON.stringify(data, null, 2).replace(/\n/g, eol);
  if (raw.endsWith(eol)) out += eol;
  writeFileSync(path, out, 'utf8');
  touched.push(file);
}

for (const file of ['package.json', 'backend/package.json', 'frontend/package.json']) {
  syncJson(
    file,
    (d) => [d.version],
    (d) => {
      d.version = version;
    },
  );
}
for (const file of ['backend/package-lock.json', 'frontend/package-lock.json']) {
  syncJson(
    file,
    (d) => [d.version, d.packages?.['']?.version],
    (d) => {
      d.version = version;
      if (d.packages?.['']) d.packages[''].version = version;
    },
  );
}

// requirements.json is written one object per line with CRLF by requirements/tools/serialize.mjs —
// a plain JSON.stringify would reformat the whole file and fail build.mjs --check.
{
  const file = 'requirements/requirements.json';
  const path = join(root, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.meta.version !== version) {
    drift.push(`${file}: meta.version ${data.meta.version}`);
    if (!CHECK) {
      data.meta.version = version;
      writeFileSync(path, serialize(data), 'utf8');
      touched.push(file);
    }
  }
}

if (CHECK) {
  if (drift.length) {
    console.error(`✗ VERSION is ${version} but these descriptors disagree (run node tools/sync-version.mjs):`);
    for (const d of drift) console.error('  - ' + d);
    process.exit(1);
  }
  console.log(`✓ every descriptor reports ${version}`);
} else if (touched.length) {
  console.log(`✓ synced to ${version}: ${touched.join(', ')}`);
} else {
  console.log(`✓ already in sync at ${version}`);
}

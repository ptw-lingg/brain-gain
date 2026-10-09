// The compiled backend must ship the non-TypeScript assets it reads from disk (SYS-SCO-05).
//
// `tsc` emits .ts only. Before scripts/copy-assets.mjs, a deployment built with `npm run build` had no
// <dist>/scorm/shim/, so the content origin answered every wrapper.html with a 500 and no SCORM course
// could start (found while installing 1.4.0). The suites run under tsx from src/, which hides it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(backendDir, 'src');
const SHIM_FILES = ['wrapper.html', 'scorm-api.js'];

/** Every file under src/ that is not TypeScript and not the dev data directory, relative to src/. */
function sourceAssets(dir = srcDir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === srcDir && entry.name === 'data') continue;
      sourceAssets(abs, found);
    } else if (entry.isFile() && !entry.name.endsWith('.ts')) {
      found.push(relative(srcDir, abs));
    }
  }
  return found;
}

test('SYS-SCO-05 / VT-198: npm run build copies the assets after tsc, and the content server reads the shim from the path the copy writes', () => {
  const pkg = JSON.parse(readFileSync(join(backendDir, 'package.json'), 'utf8'));
  const build = pkg.scripts.build;
  assert.ok(build.includes('tsc') && build.includes('build:assets'), `build script runs tsc and build:assets: ${build}`);
  assert.ok(build.indexOf('tsc') < build.indexOf('build:assets'), 'assets are copied after tsc has written dist/');
  assert.equal(pkg.scripts['build:assets'], 'node scripts/copy-assets.mjs');

  // The layout the copy produces (<out>/scorm/shim/…) must be the one the compiled server resolves.
  const server = readFileSync(join(srcDir, 'scormServer.ts'), 'utf8');
  assert.match(server, /SHIM_DIR\s*=\s*path\.join\(__dirname,\s*'scorm',\s*'shim'\)/, 'scormServer reads <dist>/scorm/shim');
  for (const f of SHIM_FILES) assert.ok(existsSync(join(srcDir, 'scorm', 'shim', f)), `source shim ${f} exists`);
});

test('SYS-SCO-05 / VT-198: the asset copy ships the wrapper page and SCORM API shim byte-identical, plus every non-TypeScript source asset, but never the dev data directory', () => {
  const out = mkdtempSync(join(tmpdir(), 'braingain-assets-'));
  try {
    execFileSync(process.execPath, [join(backendDir, 'scripts', 'copy-assets.mjs'), '--out', out], { stdio: 'pipe' });

    for (const f of SHIM_FILES) {
      const copied = join(out, 'scorm', 'shim', f);
      assert.ok(existsSync(copied), `${f} is in <out>/scorm/shim/`);
      assert.ok(readFileSync(copied).equals(readFileSync(join(srcDir, 'scorm', 'shim', f))), `${f} is byte-identical`);
    }
    for (const rel of sourceAssets()) assert.ok(existsSync(join(out, rel)), `asset ${rel} is copied`);
    assert.ok(!existsSync(join(out, 'data')), 'src/data (dev data) is never copied into the build');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// Copies the backend's non-TypeScript runtime assets from src/ into the compiled output.
//
//   node scripts/copy-assets.mjs [--out <dir>]      (default: dist/, next to src/)
//
// `tsc` emits .ts files only, so anything the compiled code reads from disk next to itself would be
// missing from a deployed build. Today that is the SCORM content origin's wrapper page and SCORM API
// shim (src/scorm/shim/, read from <dist>/scorm/shim/ by scormServer.ts); under `tsx` they resolve
// from src/, which is why only a compiled deployment could notice (SYS-SCO-05). Run by `npm run
// build` after tsc. src/data is the dev DATA_DIR (git-tracked sample data), never an asset.

import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(backendDir, 'src');

const outFlag = process.argv.indexOf('--out');
if (outFlag !== -1 && !process.argv[outFlag + 1]) {
  console.error('copy-assets: --out needs a directory');
  process.exit(1);
}
const outDir = outFlag === -1 ? join(backendDir, 'dist') : resolve(process.argv[outFlag + 1]);

const SKIP_DIRS = new Set(['data']); // top-level entries of src/ that are never assets

function collect(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === srcDir && SKIP_DIRS.has(entry.name)) continue;
      collect(abs, found);
    } else if (entry.isFile() && !entry.name.endsWith('.ts')) {
      found.push(abs);
    }
  }
  return found;
}

const assets = collect(srcDir);
if (assets.length === 0) {
  console.error('copy-assets: no assets found under src/ — the SCORM shim should be there');
  process.exit(1);
}
for (const abs of assets) {
  const target = join(outDir, relative(srcDir, abs));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(abs, target);
}
console.log(`copy-assets: ${assets.length} file(s) -> ${relative(process.cwd(), outDir) || '.'}`);

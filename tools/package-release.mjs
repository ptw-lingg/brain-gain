#!/usr/bin/env node
// Build a ready-to-run release bundle — nothing is compiled or downloaded on the target machine.
//
//   node tools/package-release.mjs [<tag>]        (default: v<VERSION>)
//   → release/braingain-<version>.tgz  +  release/braingain-<version>.tgz.sha256
//
// The bundle is built from the release TAG in a throwaway git worktree (never from the working tree,
// so uncommitted edits and the dev data in backend/src/data can't leak in), then assembled as:
//
//   braingain-<version>/
//     VERSION  CHANGELOG.md  INSTALLATION.md  README.md  sbom/
//     backend/package.json  backend/package-lock.json
//     backend/dist/            compiled server (incl. dist/scorm/shim, copied by the build)
//     backend/node_modules/    production dependencies only (all pure JavaScript — no native
//                              modules, so a bundle packed on Windows runs on Linux unchanged)
//     frontend/dist/           the built SPA, served by the backend from ../../frontend/dist
//
// The target needs only Node.js (≥ 20): `node backend/dist/index.js` with DATA_DIR pointing at the
// data directory. Data is never part of a bundle. Before packing, the staged bundle is booted once
// against a temporary data directory and must answer /api/health with the bundle's version.

import { spawn, spawnSync } from 'node:child_process';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function run(cmd, args, cwd, label = `${cmd} ${args.join(' ')}`) {
  console.log(`[package] ${label}  (${cwd})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin && cmd === 'npm' });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

function git(args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** GET over HTTPS accepting the bundle's self-signed bootstrap certificate (fetch ignores a runtime
 * NODE_TLS_REJECT_UNAUTHORIZED override). */
function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: false }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

/** Boot the staged backend on a scratch data dir and wait for /api/health to report `version`. */
async function smokeTest(bundleDir, version) {
  const dataDir = mkdtempSync(join(tmpdir(), 'braingain-smoke-'));
  const port = 20000 + Math.floor(Math.random() * 40000);
  const proc = spawn(process.execPath, ['dist/index.js'], {
    cwd: join(bundleDir, 'backend'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATA_DIR: dataDir,
      HTTPS_PORT: String(port),
      HTTP_PORT: String(port + 1),
      SCORM_CONTENT_PORT: String(port + 2),
      JWT_SECRET: 'smoke-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    // Generous: on Windows the first start right after npm ci can stall while the antivirus scans the
    // freshly written node_modules (seen: > 30 s silent); a warm start takes a few seconds.
    const started = Date.now();
    const deadline = started + 180000;
    let nextNote = started + 30000;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`bundle exited early (code ${proc.exitCode}):\n${log}`);
      try {
        const health = JSON.parse(await get(`https://localhost:${port}/api/health`));
        if (health.version !== version) throw new Error(`health reports ${health.version}, expected ${version}`);
        const spa = await get(`https://localhost:${port}/`);
        if (!/<!doctype html>/i.test(spa)) throw new Error('the SPA is not served from frontend/dist');
        console.log(`[package] ✓ smoke test: /api/health ${JSON.stringify(health)} and the SPA is served`);
        return;
      } catch (err) {
        if (err instanceof Error && /health reports|SPA is not served/.test(err.message)) throw err;
        if (Date.now() > nextNote) {
          console.log(`[package]   …still waiting for the bundle to answer (${Math.round((Date.now() - started) / 1000)} s)`);
          nextNote += 30000;
        }
        await sleep(300);
      }
    }
    throw new Error(`bundle did not become healthy within 180 s:\n${log}`);
  } finally {
    proc.kill();
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5000)]);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  // `--smoke <bundleDir>`: only boot-check an already extracted bundle (e.g. before an upgrade).
  if (process.argv[2] === '--smoke') {
    const dir = process.argv[3];
    await smokeTest(dir, readFileSync(join(dir, 'VERSION'), 'utf8').trim());
    return;
  }
  const tag = process.argv[2] ?? `v${readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim()}`;
  git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
  const work = mkdtempSync(join(tmpdir(), 'braingain-package-'));
  const src = join(work, 'src');
  git(['worktree', 'add', '--detach', src, tag]);
  let keep = false; // a failed smoke test keeps the staging directory for inspection
  try {
    const version = readFileSync(join(src, 'VERSION'), 'utf8').trim();
    const name = `braingain-${version}`;

    // 1. Build both halves from the tagged sources.
    run('npm', ['ci'], join(src, 'backend'));
    run('npm', ['run', 'build'], join(src, 'backend'));
    run('npm', ['ci'], join(src, 'frontend'));
    run('npm', ['run', 'build'], join(src, 'frontend'));

    // 2. Assemble the bundle.
    const stage = join(work, 'stage', name);
    mkdirSync(join(stage, 'backend'), { recursive: true });
    mkdirSync(join(stage, 'frontend'), { recursive: true });
    for (const f of ['VERSION', 'CHANGELOG.md', 'INSTALLATION.md', 'README.md']) {
      if (existsSync(join(src, f))) cpSync(join(src, f), join(stage, f));
    }
    cpSync(join(src, 'sbom'), join(stage, 'sbom'), { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) cpSync(join(src, 'backend', f), join(stage, 'backend', f));
    cpSync(join(src, 'backend', 'dist'), join(stage, 'backend', 'dist'), { recursive: true });
    cpSync(join(src, 'frontend', 'dist'), join(stage, 'frontend', 'dist'), { recursive: true });
    run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], join(stage, 'backend'));

    for (const must of ['backend/dist/index.js', 'backend/dist/scorm/shim/wrapper.html', 'backend/dist/scorm/shim/scorm-api.js', 'frontend/dist/index.html', 'backend/node_modules/express/package.json']) {
      if (!existsSync(join(stage, must))) throw new Error(`bundle is missing ${must}`);
    }
    if (existsSync(join(stage, 'backend', 'dist', 'data'))) throw new Error('bundle must not contain data (backend/dist/data)');

    // 3. Prove it runs before shipping it.
    try {
      await smokeTest(stage, version);
    } catch (err) {
      keep = true;
      throw new Error(`${err instanceof Error ? err.message : err}
[package]   staged bundle kept at ${stage}`);
    }

    // 4. Pack + checksum.
    const outDir = join(repoRoot, 'release');
    mkdirSync(outDir, { recursive: true });
    const out = join(outDir, `${name}.tgz`);
    rmSync(out, { force: true });
    // The archive name is RELATIVE (cwd = release/): GNU tar reads "C:/…" as a remote host:path.
    run('tar', ['-czf', `${name}.tgz`, '-C', join(work, 'stage').replace(/\\/g, '/'), name], outDir, `tar -czf release/${name}.tgz`);
    const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
    writeFileSync(`${out}.sha256`, `${sha}  ${name}.tgz\n`);
    console.log(`[package] ✓ release/${name}.tgz\n[package]   sha256 ${sha}`);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', src], { cwd: repoRoot });
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[package] ✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

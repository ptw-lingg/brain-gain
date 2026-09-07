// Automated checks for semantic versioning and version-gated data migrations (SYS-VER-01..10).
//
// Every scenario boots the REAL backend against a throwaway DATA_DIR. An installation "from an older
// version" is staged with the two-boot pattern (boot → stop → edit the files on disk → boot again):
// the first boot stamps the marker and seeds, the edit rewinds or removes the marker (or plants a
// legacy record), the second boot is the upgrade under test. No production code has a test-only
// hook — planting dataVersion 0.0.0 makes every registered step pending against the real registry.
//
//   SYS-VER-01 / VT-220  VERSION is the single source of truth (descriptors, lockfiles, meta.version)
//   SYS-VER-02 / VT-220  /api/health carries the version; /api/version is admin-only
//   SYS-VER-03 / VT-221  marker: fresh dir → initialized at app version; unmarked dir → adopted at 1.2.0
//   SYS-VER-04 / VT-221  gated steps run once, marker advanced per step, nothing on a repeat boot
//   SYS-VER-05 / VT-221  the shape-normalizing pass still runs whatever the marker says
//   SYS-VER-06 / VT-222  a pre-migration backup precedes the first step; none when nothing is due
//   SYS-VER-07 / VT-223  newer data refuses to boot (exit 1); ALLOW_DATA_DOWNGRADE overrides
//   SYS-VER-08 / VT-224  v1 archive → baseline → re-migrated on restore; newer archive → 409
//   SYS-VER-09 / VT-225  CHANGELOG section, release skill, descriptors in sync
//   SYS-VER-10 / VT-221  the 1.3.0 step prunes the stale settings key

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { startTestServer, startTestServerExpectingExit } from './helpers/server.mjs';
import { compareVersions as toolsCompareVersions } from '../../tools/version.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim();
const BASELINE = '1.2.0'; // BASELINE_DATA_VERSION in backend/src/services/appVersion.ts
const SEMVER = /^\d+\.\d+\.\d+$/;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
const marker = (dir) => readJson(join(dir, '_meta.json'));
const preMigration = (backups) => backups.filter((b) => b.source === 'pre-migration');

let srv;
let adminToken;
let memberToken;
const scratch = [];

async function login(server, email, password) {
  const res = await server.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.token;
}

async function listBackups(server, token) {
  const res = await server.request('GET', '/api/backups', { token });
  assert.equal(res.status, 200);
  return res.body;
}

async function getBytes(server, path, token) {
  const res = await fetch(`${server.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

async function upload(server, bytes, name, token) {
  const res = await fetch(`${server.baseUrl}/api/backups/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
}

/** A real backup of the shared server, loaded as a JSZip for rewriting. */
async function createArchive() {
  const created = await srv.request('POST', '/api/backups', { token: adminToken });
  assert.equal(created.status, 201);
  const dl = await getBytes(srv, `/api/backups/${created.body.id}/download`, adminToken);
  assert.equal(dl.status, 200);
  return JSZip.loadAsync(dl.bytes);
}
const readZipJson = async (zip, name) => JSON.parse(await zip.file(name).async('string'));
async function rewriteZipJson(zip, name, fn) {
  zip.file(name, JSON.stringify(fn(await readZipJson(zip, name)), null, 2));
}

/** Boot once on a new directory (stamps the marker, seeds), stop, and hand the directory back for editing. */
async function stagedDir() {
  const dir = mkdtempSync(join(tmpdir(), 'braingain-ver-'));
  scratch.push(dir);
  const first = await startTestServer({ env: { DATA_DIR: dir } });
  await first.stop(); // removes only the helper's own (unused) temp dir — `dir` survives
  assert.equal(marker(dir).dataVersion, VERSION, 'the first boot stamped the marker at the app version');
  return dir;
}

before(async () => {
  srv = await startTestServer();
  adminToken = await login(srv, 'admin@braingain.app', 'admin123');
  memberToken = await login(srv, 'user@braingain.app', 'user123');
});

after(async () => {
  await srv?.stop();
  for (const dir of scratch) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ───────────────────────── SYS-VER-01 / SYS-VER-02 — one version, everywhere ─────────────────────────

test('SYS-VER-01 / SYS-VER-02 / SR-186 / VT-220: the root VERSION file is the single source of truth and /api/health reports it', async () => {
  assert.match(VERSION, SEMVER, 'VERSION is strict MAJOR.MINOR.PATCH');
  for (const f of ['package.json', 'backend/package.json', 'frontend/package.json']) {
    assert.equal(readJson(join(repoRoot, f)).version, VERSION, `${f} repeats VERSION`);
  }
  for (const f of ['backend/package-lock.json', 'frontend/package-lock.json']) {
    const lock = readJson(join(repoRoot, f));
    assert.equal(lock.version, VERSION, `${f} root version`);
    assert.equal(lock.packages[''].version, VERSION, `${f} packages[""] version`);
  }
  assert.equal(readJson(join(repoRoot, 'requirements/requirements.json')).meta.version, VERSION, 'requirements meta.version');

  // The tooling's comparator (tools/version.mjs) orders like the backend's (appVersion.ts) — the
  // backend's ordering is what the gate scenarios below observe; pin the ESM twin here.
  assert.equal(toolsCompareVersions(BASELINE, VERSION), -1);
  assert.equal(toolsCompareVersions(VERSION, VERSION), 0);
  assert.equal(toolsCompareVersions('1.10.0', '1.9.9'), 1, 'numeric, not lexical');

  const health = await srv.request('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true, version: VERSION });
});

test('SYS-VER-02 / SR-186 / VT-220: GET /api/version reports the app and data versions to an admin and is refused to a non-admin', async () => {
  const admin = await srv.request('GET', '/api/version', { token: adminToken });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.app, VERSION);
  assert.equal(admin.body.data, VERSION, 'a fresh installation is fully migrated');
  assert.match(admin.body.migratedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Array.isArray(admin.body.history) && admin.body.history.some((h) => h.action === 'initialized'));

  assert.equal((await srv.request('GET', '/api/version', { token: memberToken })).status, 403, 'member → 403');
  assert.equal((await srv.request('GET', '/api/version')).status, 401, 'anonymous → 401');
});

// ───────────────────────── SYS-VER-03 / 04 / 10 — the marker and the gated steps ─────────────────────────

test('SYS-VER-03 / SR-187 / VT-221: a fresh data directory is stamped at the app version and runs no historical migration', async () => {
  const m = marker(srv.dataDir);
  assert.equal(m.app, 'BrainGain');
  assert.equal(m.dataVersion, VERSION);
  assert.equal(m.appVersion, VERSION);
  assert.equal(m.history[0].action, 'initialized', 'stamped, not adopted — no store existed before seed()');
  assert.ok(!m.history.some((h) => h.action === 'adopted' || h.action === 'migrated'), 'no historical step touched fresh data');
  assert.equal(preMigration(await listBackups(srv, adminToken)).length, 0, 'nothing was due → no recovery point taken');
});

let upgradedDir; // handed from the adoption scenario to the "exactly once" scenario

test('SYS-VER-03 / SYS-VER-04 / SYS-VER-10 / SR-187 / VT-221: a data directory with no marker is adopted at the baseline and the due migration step runs', async () => {
  const dir = await stagedDir();
  rmSync(join(dir, '_meta.json')); // an installation from before versioning existed
  const settingsPath = join(dir, 'settings.json');
  const settingsBefore = readJson(settingsPath);
  writeJson(settingsPath, { ...settingsBefore, materialLocales: ['en', 'de'] }); // the stale key the 1.3.0 step prunes

  const server = await startTestServer({ env: { DATA_DIR: dir } });
  try {
    const m = marker(dir);
    assert.equal(m.dataVersion, VERSION, 'the marker ends at the app version');
    const adopted = m.history.findIndex((h) => h.action === 'adopted' && h.version === BASELINE);
    const migrated = m.history.findIndex((h) => h.action === 'migrated' && h.version === '1.3.0');
    assert.ok(adopted >= 0, 'adopted at the baseline 1.2.0');
    assert.ok(migrated > adopted, 'the 1.3.0 step ran after the adoption');
    assert.equal(m.history[migrated].changed, true, 'the step reports that it changed data');
    assert.match(m.history[migrated].note, /materialLocales/, 'the history names what was pruned');

    const settingsAfter = readJson(settingsPath);
    assert.ok(!('materialLocales' in settingsAfter), 'the stale key is gone from settings.json');
    assert.equal(settingsAfter.companyName, settingsBefore.companyName, 'known keys survive untouched');

    const token = await login(server, 'admin@braingain.app', 'admin123');
    const audit = await server.request('GET', '/api/audit?action=data-migrated', { token });
    assert.equal(audit.status, 200);
    assert.ok(audit.body.total >= 1, 'the upgrade is in the audit trail');
    assert.equal(audit.body.entries[0].entityType, 'system');
    assert.equal(audit.body.entries[0].actor, null, 'actor-less: the server upgraded itself');
    assert.equal(audit.body.entries[0].entityName, `${BASELINE} → ${VERSION}`);
  } finally {
    await server.stop();
  }
  upgradedDir = dir;
});

test('SYS-VER-04 / SR-187 / VT-221: a migration step runs exactly once — a second boot at the same data version changes nothing', async () => {
  assert.ok(upgradedDir, 'the adoption scenario ran first');
  const before = marker(upgradedDir);
  const server = await startTestServer({ env: { DATA_DIR: upgradedDir } });
  try {
    assert.deepEqual(marker(upgradedDir), before, 'the marker is byte-identical after a boot at the same data version');
    const token = await login(server, 'admin@braingain.app', 'admin123');
    assert.equal(preMigration(await listBackups(server, token)).length, 1, 'still exactly the one recovery point from the upgrade');
  } finally {
    await server.stop();
  }
});

// ───────────────────────── SYS-VER-05 — the normalize pass is not version-gated ─────────────────────────

test('SYS-VER-05 / SR-187 / VT-221: the shape-normalizing pass still runs on every boot, whatever the data version says', async () => {
  const dir = await stagedDir(); // marker already at the app version
  const path = join(dir, 'trainings.json');
  const trainings = readJson(path);
  assert.ok(trainings.length > 0, 'seeded trainings exist');
  const legacy = trainings[0];
  delete legacy.durationMinutes;
  legacy.durationHours = 1.5; // the pre-minutes shape migrateDurations converts
  writeJson(path, trainings);

  const server = await startTestServer({ env: { DATA_DIR: dir } });
  try {
    const after = readJson(path).find((t) => t.id === legacy.id);
    assert.equal(after.durationMinutes, 90, 'hours → minutes, although the marker said "current"');
    assert.ok(!('durationHours' in after), 'the legacy field is gone');
    const m = marker(dir);
    assert.equal(m.dataVersion, VERSION);
    assert.ok(!m.history.some((h) => h.action === 'migrated'), 'normalizing is not a gated step — the marker records no migration');
  } finally {
    await server.stop();
  }
});

// ───────────────────────── SYS-VER-06 — the recovery point ─────────────────────────

test('SYS-VER-06 / SR-188 / VT-222: a pre-migration backup is created before the first data-changing step and skipped when nothing is due', async () => {
  const dir = await stagedDir();
  writeJson(join(dir, '_meta.json'), { ...marker(dir), dataVersion: '0.0.0' }); // every registered step becomes due

  let server = await startTestServer({ env: { DATA_DIR: dir } });
  try {
    const token = await login(server, 'admin@braingain.app', 'admin123');
    const pre = preMigration(await listBackups(server, token));
    assert.equal(pre.length, 1, 'exactly one recovery point for the whole upgrade');
    assert.match(pre[0].fileName, /-pre-migration\.zip$/, 'the archive name marks its source');
    assert.ok(existsSync(join(dir, 'backups', `${pre[0].id}.zip`)), 'the archive is on disk beside its sidecar');

    // Taken BEFORE the marker advanced: the archive records the OLD data version, so restoring it
    // later re-runs the steps.
    const dl = await getBytes(server, `/api/backups/${pre[0].id}/download`, token);
    const manifest = await readZipJson(await JSZip.loadAsync(dl.bytes), 'manifest.json');
    assert.equal(manifest.dataVersion, '0.0.0');
    assert.equal(manifest.appVersion, VERSION);

    const m = marker(dir);
    assert.equal(m.dataVersion, VERSION);
    assert.ok(m.history.some((h) => h.action === 'migrated' && h.version === '1.3.0'), 'the 1.3.0 step ran');
  } finally {
    await server.stop();
  }

  server = await startTestServer({ env: { DATA_DIR: dir } });
  try {
    const token = await login(server, 'admin@braingain.app', 'admin123');
    assert.equal(preMigration(await listBackups(server, token)).length, 1, 'nothing due → no second recovery point');
  } finally {
    await server.stop();
  }
});

// ───────────────────────── SYS-VER-07 — downgrade protection ─────────────────────────

let newerDir; // handed from the refusal scenario to the override scenario

test('SYS-VER-07 / SR-189 / VT-223: a data directory written by a newer version refuses to boot and names both versions', async () => {
  const dir = await stagedDir();
  writeJson(join(dir, '_meta.json'), { ...marker(dir), dataVersion: '99.0.0', appVersion: '99.0.0' });

  const { code, log } = await startTestServerExpectingExit({ env: { DATA_DIR: dir } });
  assert.equal(code, 1, 'exit 1, no listener bound');
  assert.match(log, /99\.0\.0/, 'the log names the data version');
  assert.ok(log.includes(VERSION), 'the log names the app version');
  assert.match(log, /newer than/i);
  assert.match(log, /ALLOW_DATA_DOWNGRADE/, 'the log names the way back');
  assert.equal(marker(dir).dataVersion, '99.0.0', 'the marker is untouched by the refusal');
  newerDir = dir;
});

test('SYS-VER-07 / SR-189 / VT-223: ALLOW_DATA_DOWNGRADE lets a newer data directory boot with a warning', async () => {
  assert.ok(newerDir, 'the refusal scenario ran first');
  const server = await startTestServer({ env: { DATA_DIR: newerDir, ALLOW_DATA_DOWNGRADE: '1' } });
  try {
    const health = await server.request('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.version, VERSION);
    assert.equal(marker(newerDir).dataVersion, '99.0.0', 'the marker is never moved downward');
  } finally {
    await server.stop();
  }
});

// ───────────────────────── SYS-VER-08 — version-aware restore ─────────────────────────

test('SYS-VER-08 / SR-190 / VT-224: an archive with no data version is treated as the baseline and re-migrated on restore', async () => {
  const zip = await createArchive();
  const manifest = await readZipJson(zip, 'manifest.json');
  assert.equal(manifest.formatVersion, 2, 'archives are format 2 now');
  assert.equal(manifest.dataVersion, VERSION);
  assert.equal(manifest.appVersion, VERSION);
  assert.ok(zip.file('data/_meta.json'), 'the marker rides along as a passenger');
  assert.ok(!manifest.files.includes('_meta.json'), 'but is not one of the swapped stores');

  // Rewrite it as a pre-versioning (format 1) archive carrying the stale settings key.
  await rewriteZipJson(zip, 'manifest.json', ({ dataVersion, appVersion, ...rest }) => ({ ...rest, formatVersion: 1 }));
  zip.remove('data/_meta.json');
  await rewriteZipJson(zip, 'data/settings.json', (s) => ({ ...s, materialLocales: ['en'] }));

  const up = await upload(srv, await zip.generateAsync({ type: 'nodebuffer' }), 'pre-versioning.zip', adminToken);
  assert.equal(up.status, 201, 'an old archive is a legitimate upload');
  const restore = await srv.request('POST', `/api/backups/${up.body.id}/restore`, { token: adminToken });
  assert.equal(restore.status, 200, JSON.stringify(restore.body));

  assert.ok(!('materialLocales' in readJson(join(srv.dataDir, 'settings.json'))), 'the restored data was migrated right away');
  const m = marker(srv.dataDir);
  assert.equal(m.dataVersion, VERSION);
  const restored = m.history.findIndex((h) => h.action === 'restored' && h.version === BASELINE);
  assert.ok(restored >= 0, 'the marker was written to the archive\'s (baseline) version');
  assert.ok(
    m.history.slice(restored + 1).some((h) => h.action === 'migrated' && h.version === '1.3.0'),
    'and the 1.3.0 step ran after the restore',
  );
});

test('SYS-VER-08 / SR-190 / VT-224: an archive from a newer version is refused with 409 and leaves the data untouched', async () => {
  const zip = await createArchive();
  await rewriteZipJson(zip, 'manifest.json', (m) => ({ ...m, dataVersion: '99.0.0', appVersion: '99.0.0' }));
  await rewriteZipJson(zip, 'data/settings.json', (s) => ({ ...s, companyName: 'SHOULD-NOT-APPEAR' }));

  const up = await upload(srv, await zip.generateAsync({ type: 'nodebuffer' }), 'from-the-future.zip', adminToken);
  assert.equal(up.status, 201, 'uploads stay permissive — the archive can be parked until the server is upgraded');
  const backupsBefore = await listBackups(srv, adminToken);

  const restore = await srv.request('POST', `/api/backups/${up.body.id}/restore`, { token: adminToken });
  assert.equal(restore.status, 409);
  assert.match(restore.body.error, /99\.0\.0/);
  assert.ok(restore.body.error.includes(VERSION), 'the message names both versions');

  const settings = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.notEqual(settings.body.companyName, 'SHOULD-NOT-APPEAR', 'nothing was written');
  assert.equal((await listBackups(srv, adminToken)).length, backupsBefore.length, 'refused before the pre-restore snapshot');
  assert.equal(marker(srv.dataDir).dataVersion, VERSION, 'the marker is untouched');
});

// ───────────────────────── SYS-VER-09 — the release procedure ─────────────────────────

test('SYS-VER-09 / SR-191 / VT-225: the release procedure is documented — CHANGELOG entry for the current version and a release skill', () => {
  const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
  const start = changelog.indexOf(`## [${VERSION}]`);
  assert.ok(start >= 0, `CHANGELOG.md has a section for ${VERSION}`);
  const next = changelog.indexOf('\n## [', start + 1);
  const section = changelog.slice(start, next === -1 ? undefined : next);
  assert.match(section, /### Data migrations/, 'the section names its data migrations (or "none")');

  assert.ok(existsSync(join(repoRoot, '.claude', 'skills', 'release', 'SKILL.md')), 'the /release skill exists');
  // Exit 0 = every descriptor repeats VERSION (the same gate npm run verify starts with).
  execFileSync(process.execPath, [join(repoRoot, 'tools', 'sync-version.mjs'), '--check'], { stdio: 'pipe' });
});

// Automated API tests for automatic scheduled backups (SYS-BAK-10 / SR-158 / VT-166).
//
// Covers:
//   - Settings.autoBackup defaults (off / every 7 days / keep 5) and the PUT /api/settings merge
//     block with its clamps (intervalDays 1..365, keep 1..100, junk → defaults).
//   - Boot catch-up: with automation enabled and the newest AUTOMATIC backup overdue, a fresh
//     backup with source 'auto' is created at the next start.
//   - Retention: after a due run only the newest `keep` automatic backups remain; manual (and any
//     other non-'auto' source) backups are never touched.
//   - Disabled: no automatic backup is created while autoBackup.enabled is false, however overdue.
//
// The schedule scenarios use the two-boot DATA_DIR pattern from materials-locale.test.mjs: boot a
// throwaway server once to seed a TEMPLATE data dir, then copy it per scenario, rewrite
// settings.json and plant backdated backups directly on disk, and boot again to watch the catch-up.
// Storage layout (see backend/src/services/backup.ts): DATA_DIR/backups/<uuid>.zip plus a sibling
// <uuid>.meta.json { id, fileName, createdAt, size, source, contents } — listBackups() reads only
// the sidecars, so a planted backup needs valid meta JSON and any bytes as its .zip.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { startTestServer } from './helpers/server.mjs';

let srv; // shared server for the settings round-trip tests
let adminToken;
let templateDir; // seeded data dir the schedule scenarios copy from

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

async function login(server, email, password) {
  const r = await server.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body.token;
}

/** Rewrite settings.json (which the first boot always creates) with the given autoBackup block. */
function setAutoBackupOnDisk(dataDir, autoBackup) {
  const file = join(dataDir, 'settings.json');
  const settings = JSON.parse(readFileSync(file, 'utf-8'));
  settings.autoBackup = autoBackup;
  writeFileSync(file, JSON.stringify(settings, null, 2), 'utf-8');
}

/** Plant a backup on disk exactly the way backup.ts stores one: <id>.zip + <id>.meta.json sidecar. */
function plantBackup(dataDir, { source, createdAt }) {
  const id = randomUUID();
  const dir = join(dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.zip`), Buffer.from('planted archive bytes'));
  const meta = {
    id,
    fileName: `braingain-backup-${createdAt.replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')}${source === 'auto' ? '-auto' : ''}.zip`,
    createdAt,
    size: 21,
    source,
    contents: { users: 0, trainings: 0, materials: 0 },
  };
  writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify(meta, null, 2), 'utf-8');
  return id;
}

/** Poll until fn() returns a truthy value (the boot catch-up is fire-and-forget, so we wait for it). */
async function waitFor(fn, what, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

/** Copy the seeded template into a fresh data dir the scenario may mutilate. */
function scenarioDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'braingain-autobak-'));
  rmSync(dir, { recursive: true, force: true });
  cpSync(templateDir, dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const listAutos = async (server, token) => {
  const res = await server.request('GET', '/api/backups', { token });
  assert.equal(res.status, 200);
  return res.body.filter((b) => b.source === 'auto');
};

before(async () => {
  srv = await startTestServer();
  adminToken = await login(srv, 'admin@braingain.app', 'admin123');

  // Seed the template data dir the schedule scenarios below copy from.
  templateDir = mkdtempSync(join(tmpdir(), 'braingain-autobak-tmpl-'));
  const seeder = await startTestServer({ env: { DATA_DIR: templateDir } });
  await seeder.stop(); // stop() removes only the helper's unused temp dir — templateDir survives
});

after(async () => {
  await srv?.stop();
  if (templateDir) rmSync(templateDir, { recursive: true, force: true });
});

// ───────────────────────── defaults & settings round-trip ─────────────────────────

test('SYS-BAK-10 / SR-158 / VT-166: automatic backups default to off, every 7 days, keep 5', async () => {
  const res = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.autoBackup, { enabled: false, intervalDays: 7, keep: 5 });
});

test('SYS-BAK-10 / SR-158 / VT-166: PUT /api/settings round-trips the autoBackup block without touching other settings', async () => {
  const before = await srv.request('GET', '/api/settings', { token: adminToken });
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { autoBackup: { enabled: true, intervalDays: 14, keep: 3 } },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.autoBackup, { enabled: true, intervalDays: 14, keep: 3 });

  const again = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.deepEqual(again.body.autoBackup, { enabled: true, intervalDays: 14, keep: 3 }, 'the values persist');
  assert.equal(again.body.passThreshold, before.body.passThreshold, 'unrelated settings are untouched');

  // Turn it back off for the shared server.
  const off = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { autoBackup: { enabled: false, intervalDays: 7, keep: 5 } },
  });
  assert.deepEqual(off.body.autoBackup, { enabled: false, intervalDays: 7, keep: 5 });
});

test('SYS-BAK-10 / SR-158 / VT-166: intervalDays and keep are clamped to 1..365 and 1..100, junk falls back to the defaults', async () => {
  const cases = [
    [{ enabled: true, intervalDays: 0, keep: 0 }, { enabled: true, intervalDays: 1, keep: 1 }],
    [{ enabled: false, intervalDays: -3, keep: -1 }, { enabled: false, intervalDays: 1, keep: 1 }],
    [{ enabled: true, intervalDays: 9999, keep: 999 }, { enabled: true, intervalDays: 365, keep: 100 }],
    [{ enabled: true, intervalDays: 3.9, keep: 2.5 }, { enabled: true, intervalDays: 3, keep: 2 }], // integers only
    [{ enabled: true, intervalDays: null, keep: null }, { enabled: true, intervalDays: 1, keep: 1 }], // null coerces to 0 → clamped up
    [{ enabled: 1, intervalDays: 'junk' }, { enabled: true, intervalDays: 7, keep: 5 }], // junk / missing → defaults
  ];
  for (const [sent, expected] of cases) {
    const res = await srv.request('PUT', '/api/settings', { token: adminToken, body: { autoBackup: sent } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.autoBackup, expected, `${JSON.stringify(sent)} is sanitized to ${JSON.stringify(expected)}`);
  }
  await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { autoBackup: { enabled: false, intervalDays: 7, keep: 5 } },
  });
});

// ───────────────────────── boot catch-up ─────────────────────────

test('SYS-BAK-10 / SR-158 / VT-166: boot catch-up — an overdue automatic backup is created once at the next start', async (t) => {
  const dataDir = scenarioDir(t);
  setAutoBackupOnDisk(dataDir, { enabled: true, intervalDays: 7, keep: 5 });
  const staleId = plantBackup(dataDir, { source: 'auto', createdAt: daysAgo(10) }); // 10 > 7 → overdue

  const bootAt = new Date(Date.now() - 60 * 1000).toISOString(); // clock-skew headroom
  const server = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const token = await login(server, 'admin@braingain.app', 'admin123');
    const autos = await waitFor(
      async () => {
        const list = await listAutos(server, token);
        return list.some((b) => b.createdAt >= bootAt) ? list : null;
      },
      'the catch-up backup to appear',
    );

    const fresh = autos.filter((b) => b.createdAt >= bootAt);
    assert.equal(fresh.length, 1, 'exactly one catch-up backup was created (no concurrent duplicates)');
    assert.equal(fresh[0].source, 'auto');
    assert.match(fresh[0].fileName, /-auto\.zip$/, 'the archive name marks it as automatic');
    assert.ok(fresh[0].contents.users >= 3, 'it is a real archive of the seeded data');
    assert.ok(autos.some((b) => b.id === staleId), 'the stale automatic backup stays (within the keep count)');
    assert.ok(existsSync(join(dataDir, 'backups', `${fresh[0].id}.zip`)), 'the archive is on disk beside its sidecar');
  } finally {
    await server.stop();
  }
});

test('SYS-BAK-10 / SR-158 / VT-166: a fresh-enough automatic backup means no new one is created at boot', async (t) => {
  const dataDir = scenarioDir(t);
  setAutoBackupOnDisk(dataDir, { enabled: true, intervalDays: 7, keep: 5 });
  const recentId = plantBackup(dataDir, { source: 'auto', createdAt: daysAgo(2) }); // 2 < 7 → not due

  const server = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const token = await login(server, 'admin@braingain.app', 'admin123');
    await sleep(3000); // the boot check runs immediately; give a wrong implementation time to show up
    const autos = await listAutos(server, token);
    assert.deepEqual(autos.map((b) => b.id), [recentId], 'the recent automatic backup is still the only one');
  } finally {
    await server.stop();
  }
});

// ───────────────────────── retention ─────────────────────────

test('SYS-BAK-10 / SR-158 / VT-166: retention keeps the newest automatic backups and never touches a manual backup', async (t) => {
  const dataDir = scenarioDir(t);
  setAutoBackupOnDisk(dataDir, { enabled: true, intervalDays: 1, keep: 2 });
  const manualId = plantBackup(dataDir, { source: 'manual', createdAt: daysAgo(6) });
  const oldestAuto = plantBackup(dataDir, { source: 'auto', createdAt: daysAgo(5) });
  const middleAuto = plantBackup(dataDir, { source: 'auto', createdAt: daysAgo(4) });
  const newestAuto = plantBackup(dataDir, { source: 'auto', createdAt: daysAgo(3) }); // 3 > 1 → due

  const server = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const token = await login(server, 'admin@braingain.app', 'admin123');
    // The due run creates a fourth auto, then prunes down to keep=2.
    const autos = await waitFor(
      async () => {
        const list = await listAutos(server, token);
        return list.length === 2 ? list : null;
      },
      'retention to settle at 2 automatic backups',
    );

    assert.ok(autos.some((b) => b.id === newestAuto), 'the newest planted auto survives (2nd newest overall)');
    assert.ok(!autos.some((b) => b.id === middleAuto), 'the older surplus autos are deleted');
    assert.ok(!autos.some((b) => b.id === oldestAuto), 'the oldest auto is deleted first');
    // …and really gone from disk, archive and sidecar both.
    for (const gone of [middleAuto, oldestAuto]) {
      assert.ok(!existsSync(join(dataDir, 'backups', `${gone}.zip`)), 'the pruned .zip is gone from disk');
      assert.ok(!existsSync(join(dataDir, 'backups', `${gone}.meta.json`)), 'the pruned sidecar is gone too');
    }

    const all = (await server.request('GET', '/api/backups', { token })).body;
    const manual = all.find((b) => b.id === manualId);
    assert.ok(manual, 'the manual backup survives retention even though it is the oldest of all');
    assert.equal(manual.source, 'manual');
    assert.ok(existsSync(join(dataDir, 'backups', `${manualId}.zip`)), 'its archive is untouched on disk');
  } finally {
    await server.stop();
  }
});

// ───────────────────────── disabled ─────────────────────────

test('SYS-BAK-10 / SR-158 / VT-166: while disabled, no automatic backup is created even when long overdue', async (t) => {
  const dataDir = scenarioDir(t);
  setAutoBackupOnDisk(dataDir, { enabled: false, intervalDays: 1, keep: 5 });
  const staleId = plantBackup(dataDir, { source: 'auto', createdAt: daysAgo(30) }); // would be overdue if enabled

  const server = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const token = await login(server, 'admin@braingain.app', 'admin123');
    await sleep(3000); // the boot check has long run by now — nothing may have happened
    const autos = await listAutos(server, token);
    assert.deepEqual(autos.map((b) => b.id), [staleId], 'the stale auto backup is untouched and no new one exists');
  } finally {
    await server.stop();
  }
});

// Automated API tests for backup & restore of all app data (SYS-BAK-01..08).
//
// Covers the system requirements / validation tests:
//   SYS-BAK-01 / VT-140  POST /api/backups snapshots all app data into a stored ZIP
//   SYS-BAK-02 / VT-141  GET /api/backups lists stored backups with size/date/contents
//   SYS-BAK-03 / VT-141  GET /api/backups/:id/download returns the archive (UUID-guarded)
//   SYS-BAK-04 / VT-142  GET /api/backups/download-all bundles every archive into one ZIP
//   SYS-BAK-05 / VT-143  POST /api/backups/upload validates before storing; junk → 400, nothing stored
//   SYS-BAK-06 / VT-144  POST /api/backups/:id/restore replaces all data after an automatic
//                        pre-restore backup; an invalid archive writes nothing
//   SYS-BAK-07 / VT-140  archive scope: the six JSON stores + materials, never data/tls/ or data/backups/
//   SYS-BAK-08 / VT-145  every backup endpoint is admin-only (401 anonymous, 403 trainer/member)
//   DELETE /api/backups/:id removes the archive (SYS-BAK-02 / VT-145)
//
// Archives are inspected with jszip, and the temp DATA_DIR exposed by the harness lets us assert what
// is on disk. Uploads use a raw octet-stream body (the JSON request() helper can't), so they go through
// fetch() directly; the helper module already disables TLS verification for the dev cert.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body.token;
}

/** GET returning raw bytes (ZIP downloads). */
async function getBytes(path, { token } = {}) {
  const res = await fetch(`${srv.baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

/** POST raw bytes to /api/backups/upload. */
async function uploadArchive(bytes, { name, token } = {}) {
  const qs = new URLSearchParams();
  if (name != null) qs.set('name', name);
  const res = await fetch(`${srv.baseUrl}/api/backups/upload?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: bytes,
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { status: res.status, body };
}

const createBackup = (token = adminToken) => srv.request('POST', '/api/backups', { token });
const listBackups = (token = adminToken) => srv.request('GET', '/api/backups', { token });

before(async () => {
  srv = await startTestServer();
  adminToken = await login('admin@braingain.app', 'admin123');
  trainerToken = await login('trainer@braingain.app', 'trainer123');
  memberToken = await login('user@braingain.app', 'user123');
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-BAK-01 / SYS-BAK-07 — create & archive scope ─────────────────────────

test('SYS-BAK-01 / SR-140 / VT-140: POST /api/backups creates a stored archive of all app data', async () => {
  const res = await createBackup();
  assert.equal(res.status, 201, 'admin can create a backup');
  const meta = res.body;
  assert.ok(UUID_RE.test(meta.id), 'the backup id is a UUID');
  assert.match(meta.fileName, /^braingain-backup-.*\.zip$/, 'the archive has a timestamped .zip name');
  assert.equal(meta.source, 'manual');
  assert.ok(meta.size > 0, 'the archive has bytes');
  assert.ok(meta.contents.users >= 3, 'the seeded users are counted in the archive contents');
  assert.ok(meta.contents.trainings >= 2, 'the seeded trainings are counted');

  // The archive really is on disk next to its sidecar, inside the data dir.
  const backupsDir = join(srv.dataDir, 'backups');
  assert.ok(existsSync(join(backupsDir, `${meta.id}.zip`)), 'the .zip is stored server-side');
  assert.ok(existsSync(join(backupsDir, `${meta.id}.meta.json`)), 'the sidecar is stored beside it');
});

test('SYS-BAK-07 / SR-140 / VT-140: the archive holds every JSON store plus material files, and a manifest', async () => {
  // Upload a material file first so the archive has bytes to carry.
  const matRes = await fetch(`${srv.baseUrl}/api/trainings/materials?name=archived.txt&type=text/plain`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${adminToken}` },
    body: Buffer.from('archived material bytes'),
  });
  assert.equal(matRes.status, 201, 'a material file was uploaded');
  const material = await matRes.json();

  const created = await createBackup();
  const dl = await getBytes(`/api/backups/${created.body.id}/download`, { token: adminToken });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/zip');
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="braingain-backup-.*\.zip"/);

  const zip = await JSZip.loadAsync(dl.bytes);
  const names = Object.keys(zip.files);

  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.app, 'BrainGain', 'the manifest identifies the producing app');
  assert.equal(manifest.formatVersion, 1);

  for (const store of ['users', 'roles', 'trainings', 'sessions', 'orgUnits', 'settings']) {
    const entry = zip.file(`data/${store}.json`);
    assert.ok(entry, `data/${store}.json is in the archive`);
    JSON.parse(await entry.async('string')); // parses as JSON
  }
  assert.ok(names.includes(`data/materials/${material.id}`), 'the material bytes are archived');
  assert.ok(names.includes(`data/materials/${material.id}.meta.json`), 'the material sidecar is archived');
  assert.equal(
    (await zip.file(`data/materials/${material.id}`).async('string')),
    'archived material bytes',
    'material bytes round-trip byte-for-byte',
  );
});

test('SYS-BAK-07 / SR-140 / VT-140: every JSON store on disk is in the archive — a new store cannot be silently omitted', async () => {
  // The allowlist is the risk: a store added later but left out of STORE_FILES would quietly stop being
  // backed up, and a restore would then mix restored and current data. Compare the archive against what
  // the running server actually persists rather than against a hardcoded list.
  const created = await createBackup();
  const dl = await getBytes(`/api/backups/${created.body.id}/download`, { token: adminToken });
  const zip = await JSZip.loadAsync(dl.bytes);

  const onDisk = readdirSync(srv.dataDir).filter((f) => f.endsWith('.json'));
  assert.ok(onDisk.length >= 6, `the server persists several JSON stores (found ${onDisk.length})`);
  for (const file of onDisk) {
    assert.ok(zip.file(`data/${file}`), `${file} exists in the data dir and must be archived`);
  }
});

test('SYS-BAK-07 / SR-140 / VT-140: the archive never contains the TLS private key or nested backups', async () => {
  // The running server generated a self-signed cert into data/tls, so there IS something to leak.
  assert.ok(existsSync(join(srv.dataDir, 'tls', 'key.pem')), 'the server has a TLS private key on disk');

  const created = await createBackup();
  const dl = await getBytes(`/api/backups/${created.body.id}/download`, { token: adminToken });
  const names = Object.keys(await JSZip.loadAsync(dl.bytes).then((z) => z.files));

  assert.equal(names.filter((n) => /tls/i.test(n)).length, 0, 'no tls/ entry — the private key never leaves the server');
  assert.equal(names.filter((n) => /key\.pem|cert\.pem/i.test(n)).length, 0, 'no PEM material in the archive');
  assert.equal(names.filter((n) => n.includes('backups/')).length, 0, 'no nested backups/ — archives do not contain each other');
});

// ───────────────────────── SYS-BAK-02 — list & delete ─────────────────────────

test('SYS-BAK-02 / SR-141 / VT-141: GET /api/backups lists stored backups newest first', async () => {
  await createBackup();
  const res = await listBackups();
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body) && res.body.length >= 2, 'several backups are listed');
  for (const b of res.body) {
    assert.ok(UUID_RE.test(b.id) && b.fileName && b.size > 0 && b.createdAt, 'each entry carries id/name/size/date');
  }
  const dates = res.body.map((b) => b.createdAt);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
});

test('SYS-BAK-02 / SR-144 / VT-145: DELETE /api/backups/:id removes the archive and its sidecar', async () => {
  const created = await createBackup();
  const { id } = created.body;
  const del = await srv.request('DELETE', `/api/backups/${id}`, { token: adminToken });
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);

  assert.ok(!existsSync(join(srv.dataDir, 'backups', `${id}.zip`)), 'the .zip is gone from disk');
  assert.ok(!existsSync(join(srv.dataDir, 'backups', `${id}.meta.json`)), 'the sidecar is gone too');
  const list = await listBackups();
  assert.equal(list.body.filter((b) => b.id === id).length, 0, 'it no longer appears in the list');

  const again = await srv.request('DELETE', `/api/backups/${id}`, { token: adminToken });
  assert.equal(again.status, 404, 'deleting a gone backup is a 404');
});

test('SYS-BAK-03 / SR-141 / VT-141: a malformed backup id is rejected, an unknown one is a 404', async () => {
  const bad = await srv.request('GET', '/api/backups/..%2F..%2Fsettings/download', { token: adminToken });
  assert.ok(bad.status === 400 || bad.status === 404, `traversal attempt is refused (got ${bad.status})`);
  const notUuid = await srv.request('GET', '/api/backups/not-a-uuid/download', { token: adminToken });
  assert.equal(notUuid.status, 400, 'a non-UUID id never reaches the filesystem');
  const unknown = await srv.request('GET', '/api/backups/11111111-2222-3333-4444-555555555555/download', { token: adminToken });
  assert.equal(unknown.status, 404, 'a well-formed but unknown id is a 404');
});

// ───────────────────────── SYS-BAK-04 — download all ─────────────────────────

test('SYS-BAK-04 / SR-142 / VT-142: GET /api/backups/download-all returns one ZIP containing every archive', async () => {
  const list = await listBackups();
  const expected = list.body.map((b) => b.fileName);
  assert.ok(expected.length >= 2, 'there are several backups to bundle');

  const dl = await getBytes('/api/backups/download-all', { token: adminToken });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/zip');
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="braingain-backups-.*\.zip"/);

  const bundle = await JSZip.loadAsync(dl.bytes);
  const entries = Object.keys(bundle.files);
  for (const name of expected) {
    assert.ok(entries.includes(name), `the bundle contains ${name}`);
  }
  // Each entry is itself a valid BrainGain archive.
  const inner = await JSZip.loadAsync(await bundle.file(expected[0]).async('nodebuffer'));
  assert.equal(JSON.parse(await inner.file('manifest.json').async('string')).app, 'BrainGain');
});

// ───────────────────────── SYS-BAK-05 — upload & validation ─────────────────────────

test('SYS-BAK-05 / SR-143 / VT-143: an admin uploads a valid archive and it joins the list', async () => {
  const created = await createBackup();
  const archive = await getBytes(`/api/backups/${created.body.id}/download`, { token: adminToken });

  const res = await uploadArchive(archive.bytes, { name: 'from-elsewhere.zip', token: adminToken });
  assert.equal(res.status, 201, 'a valid archive is accepted');
  assert.equal(res.body.source, 'upload', 'it is recorded as an upload');
  assert.equal(res.body.fileName, 'from-elsewhere.zip', 'the uploaded name is kept');
  assert.ok(res.body.contents.users >= 3, 'contents are read from the uploaded archive');

  const list = await listBackups();
  assert.ok(list.body.some((b) => b.id === res.body.id), 'the uploaded archive is listed');
});

test('SYS-BAK-05 / SR-143 / VT-143: junk and foreign archives are rejected with 400 and nothing is stored', async () => {
  const before = (await listBackups()).body.length;

  const notZip = await uploadArchive(Buffer.from('this is not a zip file'), { name: 'junk.zip', token: adminToken });
  assert.equal(notZip.status, 400, 'a non-ZIP body is refused');
  assert.match(notZip.body.error, /zip/i);

  const empty = await uploadArchive(Buffer.alloc(0), { name: 'empty.zip', token: adminToken });
  assert.equal(empty.status, 400, 'an empty body is refused');

  // A real ZIP that is not a BrainGain backup.
  const foreign = new JSZip();
  foreign.file('readme.txt', 'unrelated archive');
  const foreignRes = await uploadArchive(await foreign.generateAsync({ type: 'nodebuffer' }), { name: 'foreign.zip', token: adminToken });
  assert.equal(foreignRes.status, 400, 'a ZIP without a BrainGain manifest is refused');
  assert.match(foreignRes.body.error, /manifest/i);

  // A BrainGain manifest that claims a file the archive does not carry.
  const incomplete = new JSZip();
  incomplete.file('manifest.json', JSON.stringify({ app: 'BrainGain', formatVersion: 1, files: ['users.json'] }));
  const incompleteRes = await uploadArchive(await incomplete.generateAsync({ type: 'nodebuffer' }), { name: 'incomplete.zip', token: adminToken });
  assert.equal(incompleteRes.status, 400, 'an incomplete archive is refused');
  assert.match(incompleteRes.body.error, /incomplete|missing/i);

  assert.equal((await listBackups()).body.length, before, 'no rejected upload was stored');
});

// ───────────────────────── SYS-BAK-06 — restore ─────────────────────────

test('SYS-BAK-06 / SR-144 / VT-144: restoring replaces all current data and takes a pre-restore backup first', async () => {
  // Snapshot the current state, then change data in two stores and add a material file.
  const snapshot = await createBackup();
  const trainingsBefore = await srv.request('GET', '/api/trainings', { token: adminToken });
  const originalName = trainingsBefore.body[0].name;

  const renamed = `Renamed before restore ${Date.now()}`;
  const put = await srv.request('PUT', `/api/trainings/${trainingsBefore.body[0].id}`, {
    token: adminToken,
    body: { ...trainingsBefore.body[0], name: renamed },
  });
  assert.equal(put.status, 200, 'the training was renamed');
  const newRole = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: `Role added after snapshot ${Date.now()}`, trainingIds: [] },
  });
  assert.equal(newRole.status, 201, 'a role was added after the snapshot');

  // Restore the snapshot.
  const res = await srv.request('POST', `/api/backups/${snapshot.body.id}/restore`, { token: adminToken });
  assert.equal(res.status, 200, 'the restore succeeded');
  assert.equal(res.body.restored, true);
  assert.ok(UUID_RE.test(res.body.safetyBackupId), 'a pre-restore safety backup id is returned');

  // Data is back to the snapshot: the rename is undone and the new role is gone.
  const trainingsAfter = await srv.request('GET', '/api/trainings', { token: adminToken });
  assert.equal(trainingsAfter.body[0].name, originalName, 'the renamed training is back to its old name');
  const rolesAfter = await srv.request('GET', '/api/roles', { token: adminToken });
  assert.equal(rolesAfter.body.filter((r) => r.id === newRole.body.id).length, 0, 'the post-snapshot role is gone');

  // The safety backup is listed and is a real archive, so the restore is undoable.
  const list = await listBackups();
  const safety = list.body.find((b) => b.id === res.body.safetyBackupId);
  assert.ok(safety, 'the safety backup is listed');
  assert.equal(safety.source, 'pre-restore');
  assert.match(safety.fileName, /pre-restore/, 'its name marks it as the pre-restore snapshot');

  // Restoring the safety backup brings the changed state back — proving it captured the newer data.
  const undo = await srv.request('POST', `/api/backups/${safety.id}/restore`, { token: adminToken });
  assert.equal(undo.status, 200);
  const undone = await srv.request('GET', '/api/trainings', { token: adminToken });
  assert.equal(undone.body.find((tr) => tr.name === renamed)?.name, renamed, 'the pre-restore snapshot restored the newer state');
});

test('SYS-BAK-06 / SR-144 / VT-144: the TLS certificate and the backup list survive a restore', async () => {
  const keyBefore = readFileSync(join(srv.dataDir, 'tls', 'key.pem'), 'utf-8');
  const created = await createBackup();
  const countBefore = (await listBackups()).body.length;

  const res = await srv.request('POST', `/api/backups/${created.body.id}/restore`, { token: adminToken });
  assert.equal(res.status, 200);

  assert.equal(readFileSync(join(srv.dataDir, 'tls', 'key.pem'), 'utf-8'), keyBefore, 'the running private key is untouched');
  const after = (await listBackups()).body;
  // The restore adds its own pre-restore snapshot; nothing is lost.
  assert.ok(after.length >= countBefore + 1, 'the backup list survived the restore (plus the new safety backup)');
  assert.ok(after.some((b) => b.id === created.body.id), 'the restored-from backup is still listed');
});

test('SYS-BAK-06 / SR-144 / VT-144: restoring a corrupt archive writes nothing', async () => {
  // Corrupt a stored archive on disk, then try to restore it.
  const created = await createBackup();
  writeFileSync(join(srv.dataDir, 'backups', `${created.body.id}.zip`), Buffer.from('no longer a zip'));

  const trainingsBefore = await srv.request('GET', '/api/trainings', { token: adminToken });
  const res = await srv.request('POST', `/api/backups/${created.body.id}/restore`, { token: adminToken });
  assert.equal(res.status, 400, 'a corrupt archive is refused');
  assert.match(res.body.error, /zip|manifest|corrupt/i);

  const trainingsAfter = await srv.request('GET', '/api/trainings', { token: adminToken });
  assert.deepEqual(
    trainingsAfter.body.map((tr) => tr.id),
    trainingsBefore.body.map((tr) => tr.id),
    'the dataset is untouched after a refused restore',
  );
  // No staging leftovers.
  const stray = readdirSync(srv.dataDir).filter((f) => f.startsWith('.restore-staging'));
  assert.deepEqual(stray, [], 'no staging directory is left behind');
});

test('SYS-BAK-06 / SR-144 / VT-144: restoring an unknown backup id is a 404', async () => {
  const res = await srv.request('POST', '/api/backups/11111111-2222-3333-4444-555555555555/restore', { token: adminToken });
  assert.equal(res.status, 404);
});

test('SYS-BAK-06 / SR-140 / VT-140: a restored archive re-materializes uploaded material files', async () => {
  // Upload a file, back up, delete the training material from disk by restoring an older archive.
  const matRes = await fetch(`${srv.baseUrl}/api/trainings/materials?name=restored.txt&type=text/plain`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${adminToken}` },
    body: Buffer.from('bytes that must survive a restore'),
  });
  const material = await matRes.json();
  const withFile = await createBackup();

  // Restore it and confirm the bytes are downloadable again afterwards.
  const res = await srv.request('POST', `/api/backups/${withFile.body.id}/restore`, { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.materials >= 1, 'the restore reports the material files it wrote');

  const dl = await getBytes(`/api/trainings/materials/${material.id}`, { token: adminToken });
  assert.equal(dl.status, 200, 'the material is still downloadable after the restore');
  assert.equal(dl.bytes.toString(), 'bytes that must survive a restore');
});

// ───────────────────────── SYS-BAK-08 — admin-only ─────────────────────────

test('SYS-BAK-08 / SR-145 / VT-145: every backup endpoint requires an admin (401 anonymous, 403 trainer/member)', async () => {
  const created = await createBackup();
  const { id } = created.body;
  const calls = [
    ['GET', '/api/backups'],
    ['POST', '/api/backups'],
    ['GET', '/api/backups/download-all'],
    ['GET', `/api/backups/${id}/download`],
    ['POST', `/api/backups/${id}/restore`],
    ['DELETE', `/api/backups/${id}`],
  ];
  for (const [method, path] of calls) {
    const anon = await srv.request(method, path);
    assert.equal(anon.status, 401, `${method} ${path} → 401 without a token`);
    const trainer = await srv.request(method, path, { token: trainerToken });
    assert.equal(trainer.status, 403, `${method} ${path} → 403 for a trainer`);
    const member = await srv.request(method, path, { token: memberToken });
    assert.equal(member.status, 403, `${method} ${path} → 403 for a member`);
  }

  // The upload endpoint takes a raw body, so it is checked separately.
  const anonUpload = await uploadArchive(Buffer.from('x'), { name: 'x.zip' });
  assert.equal(anonUpload.status, 401, 'upload → 401 without a token');
  const trainerUpload = await uploadArchive(Buffer.from('x'), { name: 'x.zip', token: trainerToken });
  assert.equal(trainerUpload.status, 403, 'upload → 403 for a trainer');

  // Nothing above leaked data or mutated anything: the backup is still there.
  const list = await listBackups();
  assert.ok(list.body.some((b) => b.id === id), 'the refused calls changed nothing');
});

test('SYS-BAK-08 / SR-145 / VT-145: a non-admin never receives archive bytes', async () => {
  const created = await createBackup();
  const asMember = await getBytes(`/api/backups/${created.body.id}/download`, { token: memberToken });
  assert.equal(asMember.status, 403);
  assert.ok(!asMember.bytes.toString('utf-8').includes('PK'), 'no ZIP bytes are returned to a member');
  const bundle = await getBytes('/api/backups/download-all', { token: memberToken });
  assert.equal(bundle.status, 403);
});

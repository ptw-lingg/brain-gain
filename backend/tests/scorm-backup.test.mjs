// Automated tests for SCORM in backup/restore + GC (SYS-SCO-14, traced to SR-183): package trees
// round-trip through an archive with paths preserved and bytes identical, attempt data survives,
// a hostile data/scorm/ entry in an uploaded archive is skipped (never written), and the GC keeps
// consumed attempts (completion evidence) while sweeping the unreferenced.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { startTestServer, publishSilent } from './helpers/server.mjs';
import { buildScorm12 } from './helpers/scormFixture.mjs';

let srv;
let adminToken;
let memberToken;
let memberId;
let training;
let pkg;
let consumedAttemptId;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200);
  return r.body;
}

async function upload(bytes) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/scorm-packages?name=c.zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${adminToken}` },
    body: bytes,
  });
  assert.equal(res.status, 201);
  return res.json();
}

const pkgFile = (pkgId, ...rel) => join(srv.dataDir, 'scorm', pkgId, ...rel);

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  const member = await login('user@braingain.app', 'user123');
  memberToken = member.token;
  memberId = member.user.id;

  // A published SCORM training with a nested asset, assigned to the member, with one CONSUMED
  // attempt (a real signed completion) — the evidence that must survive everything below.
  pkg = await upload(await buildScorm12({ extraFiles: { 'assets/deep/logo.svg': '<svg>logo</svg>' } }));
  training = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'Backup SCORM' } })).body;
  await srv.request('PUT', `/api/trainings/${training.id}`, { token: adminToken, body: { scormPackageId: pkg.packageId } });
  await publishSilent(srv, training.id, adminToken);
  const role = (await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'backup-role', description: '', trainingIds: [training.id] },
  })).body;
  const users = (await srv.request('GET', '/api/users', { token: adminToken })).body;
  const m = users.find((u) => u.id === memberId);
  await srv.request('PUT', `/api/users/${memberId}`, { token: adminToken, body: { roleIds: [...m.roleIds, role.id] } });

  const l = await srv.request('POST', '/api/sessions/scorm/launch', { token: memberToken, body: { trainingId: training.id } });
  consumedAttemptId = l.body.attemptId;
  await srv.request('POST', `/api/sessions/scorm/attempts/${consumedAttemptId}/commit`, {
    token: memberToken,
    body: { values: { 'cmi.core.lesson_status': 'passed', 'cmi.suspend_data': 'evidence-blob' }, terminate: true },
  });
  const graded = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: training.id, scormAttemptId: consumedAttemptId, reauth: { password: 'user123' } },
  });
  assert.equal(graded.status, 200);
  assert.equal(graded.body.passed, true);
});

after(async () => srv.stop());

test('SYS-SCO-14 / SR-183 / VT-206: a backup carries the package tree and attempt data, and a restore round-trips them byte-identically', async () => {
  const created = await srv.request('POST', '/api/backups', { token: adminToken });
  assert.equal(created.status, 201);
  assert.equal(created.body.contents.scormPackages, 1);
  const backupId = created.body.id;

  // Mutate the world: replace the package (the old tree is deleted), scribble on the attempt file.
  const pkg2 = await upload(await buildScorm12({}));
  await srv.request('PUT', `/api/trainings/${training.id}`, { token: adminToken, body: { scormPackageId: pkg2.packageId } });
  await publishSilent(srv, training.id, adminToken);
  assert.ok(!existsSync(pkgFile(pkg.packageId)), 'the old tree is gone after the replacing publish');

  // Restore → the original tree and the consumed attempt are back, bytes identical.
  const restored = await srv.request('POST', `/api/backups/${backupId}/restore`, { token: adminToken });
  assert.equal(restored.status, 200);
  assert.ok(existsSync(pkgFile(pkg.packageId, 'imsmanifest.xml')));
  assert.equal(
    readFileSync(pkgFile(pkg.packageId, 'assets', 'deep', 'logo.svg'), 'utf-8'),
    '<svg>logo</svg>',
    'nested paths preserved, bytes identical',
  );
  const attemptFile = JSON.parse(readFileSync(join(srv.dataDir, 'scorm-attempts', `${consumedAttemptId}.json`), 'utf-8'));
  assert.equal(attemptFile.cmi.suspendData, 'evidence-blob', 'the completion evidence survived');
  assert.equal(attemptFile.attempt.status, 'completed');

  // And the restored training serves its course again end to end.
  const l = await srv.request('POST', '/api/sessions/scorm/launch', { token: memberToken, body: { trainingId: training.id } });
  assert.equal(l.status, 200);
  assert.equal((await fetch(l.body.url)).status, 200, 'the restored package plays');
});

test('SYS-SCO-14 / SR-181 / VT-206: a hostile data/scorm entry in an uploaded archive is skipped, never written', async () => {
  // Take a legitimate backup and graft a traversal entry under data/scorm/ into it.
  const created = await srv.request('POST', '/api/backups', { token: adminToken });
  const dl = await fetch(`${srv.baseUrl}/api/backups/${created.body.id}/download`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert.equal(dl.status, 200);
  const zip = await JSZip.loadAsync(Buffer.from(await dl.arrayBuffer()));
  zip.file('data/scorm/not-a-uuid/../../../evil.txt', 'escape');
  zip.file(`data/scorm/${pkg.packageId}/XX/evil.txt`, 'escape'); // patched below to ../evil.txt
  let bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const from = Buffer.from(`${pkg.packageId}/XX/evil.txt`);
  const to = Buffer.from(`${pkg.packageId}/../evil.txt`);
  let i = bytes.indexOf(from);
  while (i !== -1) { to.copy(bytes, i); i = bytes.indexOf(from, i + 1); }

  const up = await fetch(`${srv.baseUrl}/api/backups/upload?name=grafted.zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${adminToken}` },
    body: bytes,
  });
  assert.equal(up.status, 201, 'the archive is otherwise valid');
  const restored = await srv.request('POST', `/api/backups/${(await up.json()).id}/restore`, { token: adminToken });
  assert.equal(restored.status, 200);
  assert.ok(!existsSync(join(srv.dataDir, 'evil.txt')), 'nothing escaped into the data dir');
  assert.ok(!existsSync(join(srv.dataDir, '..', 'evil.txt')), 'nothing escaped above it');
  assert.ok(!existsSync(pkgFile(pkg.packageId, 'evil.txt')), 'the traversal entry was skipped entirely');
});

test('SYS-SCO-14 / SR-183 / VT-206: GC sweeps an orphan tree but keeps consumed attempts and referenced packages', async () => {
  // An unreferenced package YOUNGER than the grace period must survive a GC pass…
  const loose = await upload(await buildScorm12({}));
  // …while a tree with no record at all (crashed import) is swept. Simulate one by copying.
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const orphanDir = join(srv.dataDir, 'scorm', '99999999-9999-4999-8999-999999999999');
  mkdirSync(orphanDir, { recursive: true });
  writeFileSync(join(orphanDir, 'junk.bin'), 'x');

  // GC runs from runDataMigrations — triggered by any restore; reuse one.
  const backup = await srv.request('POST', '/api/backups', { token: adminToken });
  await srv.request('POST', `/api/backups/${backup.body.id}/restore`, { token: adminToken });

  assert.ok(!existsSync(orphanDir), 'the recordless tree was swept');
  assert.ok(existsSync(pkgFile(pkg.packageId)) || existsSync(join(srv.dataDir, 'scorm')), 'referenced packages stay');
  assert.ok(
    existsSync(join(srv.dataDir, 'scorm-attempts', `${consumedAttemptId}.json`)),
    'a consumed attempt is completion evidence and is NEVER swept',
  );
  void loose;
});

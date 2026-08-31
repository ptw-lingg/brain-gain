// Automated API tests for SCORM package import (SYS-SCO-02/03/13, traced to SR-176 / SR-181):
// valid 1.2/2004/nested packages import and stage into the training draft; multi-SCO, manifest-
// less, hostile-path, oversize and mislabelled archives are refused with a stable code and leave
// NOTHING on disk; upload is trainer/admin-gated; the learner payload never carries the package id
// or manifest internals.
//
// Uploads use a raw octet-stream body (the JSON request() helper can't), so they go through
// fetch() directly against srv.baseUrl — the materials.test.mjs pattern.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startTestServer, publishSilent } from './helpers/server.mjs';
import { buildScorm12, buildScorm2004, buildEvilPackage } from './helpers/scormFixture.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

async function upload(bytes, { name = 'course.zip', token } = {}) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/scorm-packages?name=${encodeURIComponent(name)}`, {
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

/** Files under DATA_DIR/scorm (package trees) — the "nothing left behind" probe. */
const scormDirs = () => {
  try { return readdirSync(join(srv.dataDir, 'scorm')); } catch { return []; }
};

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  trainerToken = (await login('trainer@braingain.app', 'trainer123')).token;
  memberToken = (await login('user@braingain.app', 'user123')).token;
});

after(async () => srv.stop());

test('SYS-SCO-02 / SR-176 / VT-193: a minimal SCORM 1.2 package imports with parsed manifest data', async () => {
  const { status, body } = await upload(await buildScorm12({}), { token: trainerToken, name: 'fire-safety.zip' });
  assert.equal(status, 201);
  assert.equal(body.version, '1.2');
  assert.equal(body.title, 'Lesson 1');
  assert.equal(body.entryHref, 'index.html');
  assert.equal(body.masteryScore, 0.8, 'adlcp:masteryscore 80 normalizes to 0.8');
  assert.equal(body.originalFileName, 'fire-safety.zip');
  assert.equal(body.completionRule, 'status');
  assert.equal(body.allowExternal, false);
  assert.ok(body.fileCount >= 2);
  assert.ok(scormDirs().includes(body.packageId), 'the extracted tree is on disk');
});

test('SYS-SCO-03 / SR-176 / VT-194: a SCORM 2004 package imports with version detection and minNormalizedMeasure', async () => {
  const { status, body } = await upload(await buildScorm2004({}), { token: adminToken });
  assert.equal(status, 201);
  assert.equal(body.version, '2004');
  assert.equal(body.masteryScore, 0.8);
});

test('SYS-SCO-02 / SR-176 / VT-193: a package nested one folder deep imports (the manifest directory becomes the root)', async () => {
  const { status, body } = await upload(await buildScorm12({ nested: true }), { token: trainerToken });
  assert.equal(status, 201);
  assert.equal(body.entryHref, 'index.html', 'paths are re-based onto the manifest directory');
});

test('SYS-SCO-03 / SR-181 / VT-195: a multi-SCO package is refused 422 naming the count, and nothing is stored', async () => {
  const dirsBefore = scormDirs().length;
  const { status, body } = await upload(await buildEvilPackage('multi-sco'), { token: trainerToken });
  assert.equal(status, 422);
  assert.equal(body.code, 'multi-sco');
  assert.match(body.error, /3 launchable parts/);
  assert.equal(scormDirs().length, dirsBefore, 'no tree was left behind');
});

test('SYS-SCO-13 / SR-181 / VT-196: hostile archives are refused with their code and write nothing outside DATA_DIR/scorm', async () => {
  const dirsBefore = scormDirs().length;
  const cases = [
    ['not-a-zip', 'not-a-zip'],
    ['absolute', 'path-traversal'],
    ['backslash', 'path-traversal'],
    ['symlink', 'symlink'],
    ['traversal-entry', 'path-traversal'],
    ['too-many-files', 'too-many-entries'],
  ];
  for (const [kind, code] of cases) {
    const { status, body } = await upload(await buildEvilPackage(kind), { token: trainerToken });
    assert.equal(status, 422, `${kind} refused`);
    assert.equal(body.code, code, `${kind} → ${code}`);
  }
  assert.equal(scormDirs().length, dirsBefore, 'no rejected package left a tree');
  // A leading-../ entry name never even reaches the census: the zip LIBRARY normalizes it away on
  // load (first defense layer), so the archive imports as a harmless extra file. The assertion
  // that matters is the end state: nothing escaped onto the filesystem.
  const traversal = await upload(await buildEvilPackage('traversal'), { token: trainerToken });
  assert.ok([201, 422].includes(traversal.status), 'defused by the zip library or refused by the census');
  const dataDirEntries = readdirSync(srv.dataDir);
  assert.ok(!dataDirEntries.includes('evil.txt'), 'nothing escaped into the data dir');
  assert.ok(!readdirSync(join(srv.dataDir, '..')).includes('evil.txt'), 'nothing escaped above it');
});

test('SYS-SCO-13 / SR-181 / VT-196: a zip bomb is refused by the UNPACKED size guard', async () => {
  const { status, body } = await upload(await buildEvilPackage('huge'), { token: trainerToken });
  assert.equal(status, 422);
  assert.equal(body.code, 'uncompressed-too-large');
});

test('SYS-SCO-03 / SR-181 / VT-197: manifest problems each get their own code — none, duplicates, bad entry, wrong standard, wrong version', async () => {
  const cases = [
    ['no-manifest', 'no-manifest'],
    ['two-manifests', 'bad-manifest'],
    ['missing-entry', 'entry-missing'],
    ['non-html-entry', 'entry-not-html'],
    ['cmi5', 'cmi5-not-scorm'],
    ['unsupported-version', 'unsupported-version'],
  ];
  for (const [kind, code] of cases) {
    const { status, body } = await upload(await buildEvilPackage(kind), { token: trainerToken });
    assert.equal(status, 422, `${kind} refused`);
    assert.equal(body.code, code, `${kind} → ${code}`);
  }
});

test('SYS-SCO-02 / VT-104: upload is trainer/admin-gated; a member and an anonymous caller are refused', async () => {
  const bytes = await buildScorm12({});
  assert.equal((await upload(bytes, { token: memberToken })).status, 403);
  assert.equal((await upload(bytes, {})).status, 401);
  assert.equal((await upload(Buffer.alloc(0), { token: trainerToken })).status, 400, 'empty body');
});

test('SYS-SCO-02 / SR-176 / VT-193: a package attaches to a training via PUT, publishes, and the learner payload hides the internals', async () => {
  const pkg = (await upload(await buildScorm12({}), { token: adminToken })).body;
  const created = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: { name: 'SCORM Import Flow' },
  });
  assert.equal(created.status, 201);
  const trainingId = created.body.id;

  const put = await srv.request('PUT', `/api/trainings/${trainingId}`, {
    token: adminToken,
    body: { scormPackageId: pkg.packageId },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.draft.scormPackageId, pkg.packageId, 'staged in the draft, not published');
  assert.equal(put.body.scormPackageId, undefined, 'the published field is untouched by PUT');

  await publishSilent(srv, trainingId, adminToken);

  // The owner view resolves the descriptors for the editor.
  const ownerView = await srv.request('GET', `/api/trainings/${trainingId}`, { token: adminToken });
  assert.equal(ownerView.body.scormPackageId, pkg.packageId);
  assert.equal(ownerView.body.scormPackages.published.packageId, pkg.packageId);

  // The learner view: no package id, no entry href, no mastery score — only the summary.
  const learnerView = await srv.request('GET', `/api/trainings/${trainingId}`, { token: memberToken });
  assert.equal(learnerView.status, 200);
  assert.equal(learnerView.body.scormPackageId, undefined);
  assert.equal(learnerView.body.scormPackages, undefined);
  assert.deepEqual(learnerView.body.scorm, { version: '1.2', title: 'Lesson 1' });
  assert.deepEqual(learnerView.body.questions, [], 'a SCORM training exposes no quiz to the learner');
  assert.ok(!JSON.stringify(learnerView.body).includes(pkg.packageId), 'the package id appears nowhere');
});

test('SYS-SCO-02 / SR-176: a package referenced by one training cannot be attached to another', async () => {
  const pkg = (await upload(await buildScorm12({}), { token: adminToken })).body;
  const t1 = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'Holder' } })).body;
  const t2 = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'Thief' } })).body;
  assert.equal(
    (await srv.request('PUT', `/api/trainings/${t1.id}`, { token: adminToken, body: { scormPackageId: pkg.packageId } })).status,
    200,
  );
  const stolen = await srv.request('PUT', `/api/trainings/${t2.id}`, {
    token: adminToken,
    body: { scormPackageId: pkg.packageId },
  });
  assert.equal(stolen.status, 409);
  const unknown = await srv.request('PUT', `/api/trainings/${t2.id}`, {
    token: adminToken,
    body: { scormPackageId: '99999999-9999-4999-8999-999999999999' },
  });
  assert.equal(unknown.status, 400, 'an unknown package id is refused');
});

test('SYS-SCO-02: the two trainer options are PATCHable; everything else is immutable after import', async () => {
  const pkg = (await upload(await buildScorm12({}), { token: trainerToken })).body;
  const patched = await srv.request('PATCH', `/api/trainings/scorm-packages/${pkg.packageId}`, {
    token: trainerToken,
    body: { completionRule: 'exit', allowExternal: true },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.completionRule, 'exit');
  assert.equal(patched.body.allowExternal, true);
  const bad = await srv.request('PATCH', `/api/trainings/scorm-packages/${pkg.packageId}`, {
    token: trainerToken,
    body: { completionRule: 'always' },
  });
  assert.equal(bad.status, 400);
});

test('SYS-SCO-02: an unreferenced package can be deleted; an attached one is refused 409', async () => {
  const loose = (await upload(await buildScorm12({}), { token: trainerToken })).body;
  const del = await srv.request('DELETE', `/api/trainings/scorm-packages/${loose.packageId}`, { token: trainerToken });
  assert.equal(del.status, 204);
  assert.ok(!scormDirs().includes(loose.packageId), 'the tree is gone');

  const attached = (await upload(await buildScorm12({}), { token: adminToken })).body;
  const t = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'Keeps Package' } })).body;
  await srv.request('PUT', `/api/trainings/${t.id}`, { token: adminToken, body: { scormPackageId: attached.packageId } });
  const refused = await srv.request('DELETE', `/api/trainings/scorm-packages/${attached.packageId}`, { token: adminToken });
  assert.equal(refused.status, 409);
});

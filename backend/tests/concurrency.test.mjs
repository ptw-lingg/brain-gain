// Automated tests for concurrent use of the JSON stores (SYS-DATA-14 / SYS-DATA-15, traced to
// SR-192): parallel writers never lose an update, a learner's acknowledged completion or
// acknowledgement is on disk, a SCORM attempt yields exactly one session even under a double
// submit, two launches share one attempt, and a failing async handler answers 500 instead of taking
// the process down. Each scenario fires its requests with Promise.all so they overlap at the store.
//
// Before the store lock existed, the first three scenarios lost most of their writes on every run
// (10 parallel user creations → 1 persisted) and the burst regularly crashed the server with a torn
// read (`Unexpected end of JSON input` from readStore). These tests are the regression guard.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTestServer, publishSilent } from './helpers/server.mjs';
import { buildScorm12 } from './helpers/scormFixture.mjs';

let srv;
let adminToken;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.body)}`);
  return r.body;
}

const mat = (label) => ({ variants: [{ locale: 'en', label, url: `https://example.com/${label}` }] });

/** Sequentially create `n` enabled learners holding `roleIds`; returns their tokens. */
async function createLearners(prefix, n, roleIds) {
  const tokens = [];
  for (let i = 0; i < n; i++) {
    const email = `${prefix}${i}@example.com`;
    const r = await srv.request('POST', '/api/users', {
      token: adminToken,
      body: { name: `${prefix} ${i}`, email, password: 'password123', roleIds },
    });
    assert.equal(r.status, 201);
    tokens.push((await login(email, 'password123')).token);
  }
  return tokens;
}

/** A published (v1) quiz-less training with one material, assigned through a fresh role. */
async function publishedTraining(name) {
  const t = (
    await srv.request('POST', '/api/trainings', {
      token: adminToken,
      body: { name, durationMinutes: 5, materials: [mat('v1')], questions: [] },
    })
  ).body;
  await publishSilent(srv, t.id, adminToken);
  const role = (
    await srv.request('POST', '/api/roles', { token: adminToken, body: { name: `${name} role`, trainingIds: [t.id] } })
  ).body;
  return { training: t, role };
}

const grade = (token, body) => srv.request('POST', '/api/sessions/grade', { token, body });
const mySessions = (token) => srv.request('GET', '/api/sessions/mine', { token });

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
});

after(async () => srv.stop());

test('SYS-DATA-14 / SR-192 / VT-226: twelve parallel user creations all persist (no lost update on the users store)', async () => {
  const N = 12;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      srv.request('POST', '/api/users', {
        token: adminToken,
        body: { name: `Burst ${i}`, email: `burst${i}@example.com`, password: 'password123' },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status), Array(N).fill(201), 'every creation is acknowledged');
  const users = (await srv.request('GET', '/api/users', { token: adminToken })).body;
  assert.equal(users.filter((u) => u.email.startsWith('burst')).length, N, 'every acknowledged user is on disk');
});

test('SYS-DATA-14 / SR-192 / VT-226: learners passing a training simultaneously each get a persisted completion', async () => {
  const { training, role } = await publishedTraining('Concurrent completion');
  const tokens = await createLearners('learner', 8, [role.id]);
  const grades = await Promise.all(
    tokens.map((t) => grade(t, { trainingId: training.id, answers: [], reauth: { password: 'password123' } })),
  );
  assert.deepEqual(grades.map((g) => `${g.status}:${g.body.passed}`), Array(8).fill('200:true'));
  for (const t of tokens) {
    const mine = (await mySessions(t)).body;
    assert.equal(mine.filter((s) => s.trainingId === training.id).length, 1, 'the acknowledged pass is on disk');
  }
});

test('SYS-DATA-14 / SR-192 / VT-226: simultaneous confirm-materials acknowledgements all clear the pending update', async () => {
  const { training, role } = await publishedTraining('Concurrent acks');
  const tokens = await createLearners('acker', 8, [role.id]);
  // Everyone passes v1 first (sequentially — the ack is what this test races), then v2 is published
  // as a confirm-mode update they must acknowledge.
  for (const t of tokens) {
    const g = await grade(t, { trainingId: training.id, answers: [], reauth: { password: 'password123' } });
    assert.equal(g.status, 200);
  }
  await srv.request('PUT', `/api/trainings/${training.id}`, { token: adminToken, body: { materials: [mat('v2')] } });
  const pub = await srv.request('POST', `/api/trainings/${training.id}/publish-update`, {
    token: adminToken,
    body: { kind: 'notify', mode: 'confirm', deadline: '2099-01-01', emailSubject: 's', emailText: 't' },
  });
  assert.equal(pub.status, 201);
  const updateId = pub.body.update.id;

  const acks = await Promise.all(
    tokens.map((t) =>
      srv.request('POST', '/api/sessions/confirm-materials', { token: t, body: { trainingId: training.id, updateId } }),
    ),
  );
  assert.deepEqual(acks.map((a) => a.status), Array(8).fill(204));
  for (const t of tokens) {
    const mine = (await srv.request('GET', '/api/trainings/mine', { token: t })).body;
    const entry = mine.find((d) => d.training.id === training.id);
    assert.ok(entry, 'training is listed');
    assert.equal(entry.pendingUpdate, null, 'the acknowledged update is no longer pending');
  }
});

test('SYS-DATA-14 / SR-192 / VT-226: two editors saving different trainings at the same moment keep both edits', async () => {
  const a = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'A', materials: [mat('a')] } })).body;
  const b = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'B', materials: [mat('b')] } })).body;
  const [ra, rb] = await Promise.all([
    srv.request('PUT', `/api/trainings/${a.id}`, { token: adminToken, body: { name: 'A renamed' } }),
    srv.request('PUT', `/api/trainings/${b.id}`, { token: adminToken, body: { name: 'B renamed' } }),
  ]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  const all = (await srv.request('GET', '/api/trainings', { token: adminToken })).body;
  assert.equal(all.find((t) => t.id === a.id).name.en, 'A renamed');
  assert.equal(all.find((t) => t.id === b.id).name.en, 'B renamed');
});

test('SYS-DATA-14 / SR-180 / VT-226: two simultaneous grade requests for one SCORM attempt record exactly one session', async () => {
  const pkgRes = await fetch(`${srv.baseUrl}/api/trainings/scorm-packages?name=c.zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${adminToken}` },
    body: await buildScorm12({}),
  });
  assert.equal(pkgRes.status, 201);
  const pkg = await pkgRes.json();
  const t = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'Double grade' } })).body;
  await srv.request('PUT', `/api/trainings/${t.id}`, { token: adminToken, body: { scormPackageId: pkg.packageId } });
  await publishSilent(srv, t.id, adminToken);
  const role = (
    await srv.request('POST', '/api/roles', { token: adminToken, body: { name: 'Double grade role', trainingIds: [t.id] } })
  ).body;
  const [token] = await createLearners('scormer', 1, [role.id]);

  const launch = await srv.request('POST', '/api/sessions/scorm/launch', { token, body: { trainingId: t.id, restart: true } });
  assert.equal(launch.status, 200);
  const attemptId = launch.body.attemptId;
  const commit = await srv.request('POST', `/api/sessions/scorm/attempts/${attemptId}/commit`, {
    token,
    body: { values: { 'cmi.core.lesson_status': 'passed', 'cmi.core.score.raw': '90' }, terminate: true },
  });
  assert.equal(commit.status, 200);

  const body = { trainingId: t.id, scormAttemptId: attemptId, reauth: { password: 'password123' } };
  const [g1, g2] = await Promise.all([grade(token, body), grade(token, body)]);
  const statuses = [g1.status, g2.status].sort();
  assert.deepEqual(statuses, [200, 409], `one recorded, one refused as replay — got ${JSON.stringify([g1.body, g2.body])}`);
  const sessions = (await mySessions(token)).body.filter((s) => s.scormAttemptId === attemptId);
  assert.equal(sessions.length, 1, 'exactly one session names the attempt');

  // The audit trail agrees with the primary record: one completion for this attempt.
  const audit = await srv.request('GET', '/api/audit?action=training-completed', { token: adminToken });
  const entries = (audit.body.entries ?? audit.body).filter((e) => e.details?.includes(attemptId));
  assert.equal(entries.length, 1);
});

test('SYS-DATA-14 / SR-192 / VT-226: two simultaneous launches for the same learner and course share one attempt', async () => {
  const pkgRes = await fetch(`${srv.baseUrl}/api/trainings/scorm-packages?name=d.zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${adminToken}` },
    body: await buildScorm12({}),
  });
  const pkg = await pkgRes.json();
  const t = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'Double launch' } })).body;
  await srv.request('PUT', `/api/trainings/${t.id}`, { token: adminToken, body: { scormPackageId: pkg.packageId } });
  await publishSilent(srv, t.id, adminToken);
  const role = (
    await srv.request('POST', '/api/roles', { token: adminToken, body: { name: 'Double launch role', trainingIds: [t.id] } })
  ).body;
  const [token] = await createLearners('launcher', 1, [role.id]);

  const [l1, l2] = await Promise.all([
    srv.request('POST', '/api/sessions/scorm/launch', { token, body: { trainingId: t.id } }),
    srv.request('POST', '/api/sessions/scorm/launch', { token, body: { trainingId: t.id } }),
  ]);
  assert.equal(l1.status, 200);
  assert.equal(l2.status, 200);
  assert.equal(l1.body.attemptId, l2.body.attemptId, 'the second launch resumes the first attempt');
  const attempts = (await srv.request('GET', `/api/trainings/${t.id}/scorm-attempts`, { token: adminToken })).body;
  assert.equal(attempts.filter((a) => a.status === 'in-progress').length, 1, 'one open attempt in the index');
});

test('SYS-DATA-14 / SR-192 / VT-226: stores are written atomically — no temp files linger and every store parses after the bursts', async () => {
  const entries = readdirSync(srv.dataDir);
  assert.deepEqual(entries.filter((n) => n.endsWith('.tmp')), [], 'no leftover temp files');
  for (const store of ['users', 'trainings', 'sessions', 'updateAcks', 'roles', 'scormPackages', 'scormAttempts']) {
    const raw = readFileSync(join(srv.dataDir, `${store}.json`), 'utf8');
    assert.ok(Array.isArray(JSON.parse(raw)), `${store}.json is a complete JSON array`);
  }
});

test('SYS-DATA-15 / SR-192 / VT-226: a request failing inside an async handler answers a JSON 500 and the server keeps serving', async () => {
  const rolesPath = join(srv.dataDir, 'roles.json');
  const original = readFileSync(rolesPath, 'utf8');
  writeFileSync(rolesPath, '[{"id": "torn"', 'utf8'); // a torn file: JSON.parse throws inside the handler
  try {
    const r = await srv.request('GET', '/api/roles', { token: adminToken });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: 'Internal server error' });
  } finally {
    writeFileSync(rolesPath, original, 'utf8');
  }
  const health = await srv.request('GET', '/api/health');
  assert.equal(health.status, 200, 'the process survived the failing request');
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  assert.equal(roles.status, 200, 'and serves normally again');
});

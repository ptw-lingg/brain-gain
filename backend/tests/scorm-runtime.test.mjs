// Automated tests for the SCORM runtime state (SYS-SCO-07/08/09, traced to SR-177/SR-179):
// commit round-trips in both dialects, byte-exact suspend_data resume across a fresh login,
// total_time accumulation without double-counting, rejected over-cap writes, attempt immutability
// after close, and the ownership/rate guards on the commit endpoint.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';
import { buildScorm12, buildScorm2004 } from './helpers/scormFixture.mjs';

let srv;
let adminToken;
let memberToken;
let memberId;
let t12; // published 1.2 training assigned to the member
let t2004; // published 2004 training assigned to the member

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

async function makeScormTraining(name, zipBytes) {
  const pkg = await upload(zipBytes);
  const t = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name } })).body;
  await srv.request('PUT', `/api/trainings/${t.id}`, { token: adminToken, body: { scormPackageId: pkg.packageId } });
  await publishSilent(srv, t.id, adminToken);
  return { training: t, pkg };
}

async function assignToMember(trainingIds) {
  const role = (await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'scorm-runtime-role', description: '', trainingIds },
  })).body;
  const users = (await srv.request('GET', '/api/users', { token: adminToken })).body;
  const member = users.find((u) => u.id === memberId);
  await srv.request('PUT', `/api/users/${memberId}`, {
    token: adminToken,
    body: { roleIds: [...member.roleIds, role.id] },
  });
}

const launch = (trainingId, body = {}, token = memberToken) =>
  srv.request('POST', '/api/sessions/scorm/launch', { token, body: { trainingId, ...body } });
const commit = (attemptId, body, token = memberToken) =>
  srv.request('POST', `/api/sessions/scorm/attempts/${attemptId}/commit`, { token, body });

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  const member = await login('user@braingain.app', 'user123');
  memberToken = member.token;
  memberId = member.user.id;
  ({ training: t12 } = await makeScormTraining('Runtime 1.2', await buildScorm12({})));
  ({ training: t2004 } = await makeScormTraining('Runtime 2004', await buildScorm2004({})));
  await assignToMember([t12.id, t2004.id]);
});

after(async () => srv.stop());

test('SYS-SCO-07 / SR-179 / VT-200: 1.2 writes round-trip — status, big suspend_data byte-exact, resume across a fresh login', async () => {
  const first = await launch(t12.id);
  assert.equal(first.status, 200);
  const attemptId = first.body.attemptId;

  // Storyline reality: suspend_data far beyond the 1.2 spec's 4096, must survive byte-exact.
  const suspend = 'Ω'.repeat(3) + 'S'.repeat(9000) + '|slide=17|state=' + 'x'.repeat(500);
  const c = await commit(attemptId, {
    values: {
      'cmi.core.lesson_status': 'incomplete',
      'cmi.core.lesson_location': 'slide-17',
      'cmi.suspend_data': suspend,
      'cmi.core.session_time': '0000:10:00',
    },
  });
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.errors, []);
  assert.equal(c.body.completion, 'incomplete');

  // A FRESH login (new token) resumes the same attempt with the exact bytes.
  const freshToken = (await login('user@braingain.app', 'user123')).token;
  const resumed = await launch(t12.id, {}, freshToken);
  assert.equal(resumed.body.attemptId, attemptId);
  assert.equal(resumed.body.resumed, true);
  assert.equal(resumed.body.cmi['cmi.core.entry'], 'resume');
  assert.equal(resumed.body.cmi['cmi.suspend_data'], suspend, 'byte-exact round-trip');
  assert.equal(resumed.body.cmi['cmi.core.lesson_location'], 'slide-17');
});

test('SYS-SCO-07 / SR-179 / VT-201: over-cap writes are rejected (never truncated) at both layers', async () => {
  const { body } = await launch(t12.id);
  await commit(body.attemptId, { values: { 'cmi.suspend_data': 'short-and-kept' } });
  // Over the transport cap (65 536): the whole patch is refused at the door — the shim already
  // returned the SCORM error locally, so a value this size only arrives from a bypassing client.
  const transport = await commit(body.attemptId, { values: { 'cmi.suspend_data': 'x'.repeat(70000) } });
  assert.equal(transport.status, 400);
  const relaunch = await launch(t12.id);
  assert.equal(relaunch.body.cmi['cmi.suspend_data'], 'short-and-kept', 'stored value untouched');
  // Under the transport cap but over the per-key evidence cap (4 096 for interactions): processed,
  // with the offending key rejected per-key under the dialect's set-failure code.
  const perKey = await commit(body.attemptId, {
    values: { 'cmi.interactions.0.id': 'Q1', 'cmi.interactions.0.student_response': 'y'.repeat(5000) },
  });
  assert.equal(perKey.status, 200);
  assert.deepEqual(perKey.body.errors, [['cmi.interactions.0.student_response', 405]]);
  const again = await launch(t12.id);
  assert.equal(again.body.cmi['cmi.interactions.0.id'], 'Q1', 'the valid key of the batch landed');
  assert.equal(again.body.cmi['cmi.interactions.0.student_response'], undefined, 'the rejected one did not');
});

test('SYS-SCO-07 / VT-201: 2004 scaled score + total_time accumulate across two sessions without double-counting', async () => {
  const first = await launch(t2004.id);
  const attemptId = first.body.attemptId;

  // Session 1: a growing session_time committed twice must count once.
  await commit(attemptId, { values: { 'cmi.session_time': 'PT5M' } });
  await commit(attemptId, { values: { 'cmi.session_time': 'PT10M', 'cmi.score.scaled': '0.85' } });
  const t1 = await commit(attemptId, { values: {}, terminate: true, exit: 'suspend' });
  assert.equal(t1.status, 200);
  assert.equal(t1.body.scaled, 0.85);

  // Session 2 reports its own time from zero.
  const second = await launch(t2004.id);
  assert.equal(second.body.attemptId, attemptId, 'suspended attempt resumes');
  assert.equal(second.body.cmi['cmi.total_time'], 'PT10M0S', 'ten minutes, not fifteen');
  await commit(attemptId, { values: { 'cmi.session_time': 'PT2M30S' } });
  const relaunch = await launch(t2004.id);
  assert.equal(relaunch.body.cmi['cmi.total_time'], 'PT12M30S');
});

test('SYS-SCO-08 / SR-178: commits are owner-only (404 for anyone else) and validate the patch shape', async () => {
  const { body } = await launch(t12.id);
  const foreign = await commit(body.attemptId, { values: { 'cmi.suspend_data': 'x' } }, adminToken);
  assert.equal(foreign.status, 404, 'no existence oracle for other users');
  assert.equal((await commit(body.attemptId, { values: { 'not-a-cmi-key': 'x' } })).status, 400);
  assert.equal((await commit(body.attemptId, { values: { 'cmi.__proto__.evil': 'x' } })).status, 400);
  assert.equal((await commit('99999999-9999-4999-8999-999999999999', { values: {} })).status, 404);
});

test('SYS-SCO-08 / SR-178: a closed attempt is immutable — commits are refused 409', async () => {
  // Fail + grade the 1.2 attempt so it closes.
  const { body } = await launch(t12.id);
  await commit(body.attemptId, { values: { 'cmi.core.lesson_status': 'failed' }, terminate: true });
  const graded = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: t12.id, scormAttemptId: body.attemptId, reauth: { password: 'user123' } },
  });
  assert.equal(graded.status, 200);
  assert.equal(graded.body.passed, false);
  const late = await commit(body.attemptId, { values: { 'cmi.core.lesson_status': 'passed' } });
  assert.equal(late.status, 409, 'a finished attempt is immutable');
});

test('SYS-SCO-08: the per-attempt token bucket answers a flood with 429 without breaking the attempt', async () => {
  const { body } = await launch(t2004.id, { restart: true });
  let saw429 = false;
  for (let i = 0; i < 30; i++) {
    const r = await commit(body.attemptId, { values: { 'cmi.location': `slide-${i}` } });
    if (r.status === 429) saw429 = true;
  }
  assert.ok(saw429, 'the flood was throttled');
  await new Promise((r) => setTimeout(r, 1200));
  const after429 = await commit(body.attemptId, { values: { 'cmi.location': 'recovered' } });
  assert.equal(after429.status, 200, 'the bucket refills; the attempt is unharmed');
});

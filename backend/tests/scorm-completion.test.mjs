// Automated tests for the SCORM completion arm of POST /api/sessions/grade (SYS-SCO-10/11, traced
// to SR-173 / SR-178 / SR-180): the SR-173 step-up signature still gates every recorded completion;
// the score comes from the SERVER-held attempt (a body score is ignored); the SCO's failed verdict
// vetoes; passThreshold floors; the completion rules gate; replay/preview/superseded attempts are
// refused; and the quiz path refuses a SCORM training outright (the zero-questions auto-pass hole).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';
import { buildScorm12, buildScorm2004 } from './helpers/scormFixture.mjs';

let srv;
let adminToken;
let memberToken;
let memberId;
let training; // published 1.2 SCORM training assigned to the member

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
    body: { name: `scorm-completion-${Math.random().toString(36).slice(2, 8)}`, description: '', trainingIds },
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
const grade = (body, token = memberToken) =>
  srv.request('POST', '/api/sessions/grade', { token, body });
const mySessions = (token = memberToken) => srv.request('GET', '/api/sessions/mine', { token });

/** Launch (fresh) and drive the course to a given raw state. */
async function runCourse(trainingId, values, { terminate = true } = {}) {
  const l = await launch(trainingId, { restart: true });
  assert.equal(l.status, 200);
  const c = await commit(l.body.attemptId, { values, terminate });
  assert.equal(c.status, 200);
  return l.body.attemptId;
}

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  const member = await login('user@braingain.app', 'user123');
  memberToken = member.token;
  memberId = member.user.id;
  ({ training } = await makeScormTraining('Completion 1.2', await buildScorm12({})));
  await assignToMember([training.id]);
});

after(async () => srv.stop());

test('SYS-SCO-10 / SR-180 / VT-202: a passed course + valid signature persists exactly one session with the attempt as evidence', async () => {
  const attemptId = await runCourse(training.id, {
    'cmi.core.lesson_status': 'passed',
    'cmi.core.score.raw': '92',
    'cmi.core.session_time': '0000:25:00',
  });

  const before = (await mySessions()).body.filter((s) => s.trainingId === training.id);
  assert.equal(before.length, 0, 'nothing persisted before signing');

  const r = await grade({ trainingId: training.id, scormAttemptId: attemptId, reauth: { password: 'user123' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.passed, true);
  assert.equal(r.body.scorePct, 0.92);

  const sessions = (await mySessions()).body.filter((s) => s.trainingId === training.id);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].scormAttemptId, attemptId, 'the attempt travels with the session as evidence');

  // The audit entry reconstructs the decision: score, dialect, verdict, mastery, threshold, rule, signature.
  const audit = await srv.request('GET', `/api/audit?action=training-completed`, { token: adminToken });
  const entry = (audit.body.entries ?? audit.body).find((e) => e.details?.includes(attemptId));
  assert.ok(entry, 'audit entry names the attempt');
  assert.match(entry.details, /scorm 1\.2/);
  assert.match(entry.details, /success=passed/);
  assert.match(entry.details, /signed: password/);
});

test('SYS-SCO-10 / SR-180 / VT-202: a wrong password is 403, persists nothing and appends a login-failed audit entry', async () => {
  const attemptId = await runCourse(training.id, { 'cmi.core.lesson_status': 'passed' });
  const r = await grade({ trainingId: training.id, scormAttemptId: attemptId, reauth: { password: 'wrong' } });
  assert.equal(r.status, 403);
  const sessions = (await mySessions()).body.filter((s) => s.scormAttemptId === attemptId);
  assert.equal(sessions.length, 0);
  const audit = await srv.request('GET', `/api/audit?action=login-failed`, { token: adminToken });
  const entries = audit.body.entries ?? audit.body;
  assert.ok(entries.some((e) => e.details?.includes('completion signature rejected')));
  // The attempt is still open — the learner corrects the password and signs again.
  const retry = await grade({ trainingId: training.id, scormAttemptId: attemptId, reauth: { password: 'user123' } });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.passed, true);
});

test('SYS-SCO-10 / SR-180 / VT-203: a score in the request body is IGNORED — the server-held attempt decides', async () => {
  const attemptId = await runCourse(training.id, {
    'cmi.core.lesson_status': 'failed',
    'cmi.core.score.raw': '10',
  });
  const r = await grade({
    trainingId: training.id,
    scormAttemptId: attemptId,
    scorePct: 1, // forgery attempts…
    score: 100,
    passed: true,
    reauth: { password: 'user123' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.passed, false, 'the forged fields changed nothing');
  assert.equal(r.body.scorePct, 0.1);
  assert.equal((await mySessions()).body.filter((s) => s.scormAttemptId === attemptId).length, 0);
});

test('SYS-SCO-10 / VT-203: the SCO failed verdict VETOES even a perfect score; passThreshold floors a passed one', async () => {
  // success=failed at 100% → veto.
  const vetoed = await runCourse(training.id, {
    'cmi.core.lesson_status': 'failed',
    'cmi.core.score.raw': '100',
  });
  const rv = await grade({ trainingId: training.id, scormAttemptId: vetoed, reauth: { password: 'user123' } });
  assert.equal(rv.body.passed, false, 'failed verdict vetoes a perfect score');

  // passed at 50% against the default 0.8 threshold → floored.
  const floored = await runCourse(training.id, {
    'cmi.core.lesson_status': 'passed',
    'cmi.core.score.raw': '50',
  });
  const rf = await grade({ trainingId: training.id, scormAttemptId: floored, reauth: { password: 'user123' } });
  assert.equal(rf.body.passed, false, 'org passThreshold cannot be undercut by a lenient course');
  assert.equal((await mySessions()).body.filter((s) => [vetoed, floored].includes(s.scormAttemptId)).length, 0);
});

test('SYS-SCO-10 / VT-203: a completion-only course (no score at all) passes at 100%', async () => {
  const attemptId = await runCourse(training.id, { 'cmi.core.lesson_status': 'completed' });
  const r = await grade({ trainingId: training.id, scormAttemptId: attemptId, reauth: { password: 'user123' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.passed, true);
  assert.equal(r.body.scorePct, 1, 'no score reported → the completion itself is the result');
});

test('SYS-SCO-10 / VT-204: replay, foreign and still-incomplete attempts are refused', async () => {
  // Consume one attempt…
  const attemptId = await runCourse(training.id, { 'cmi.core.lesson_status': 'passed' });
  await grade({ trainingId: training.id, scormAttemptId: attemptId, reauth: { password: 'user123' } });
  // …then replay it.
  const replay = await grade({ trainingId: training.id, scormAttemptId: attemptId, reauth: { password: 'user123' } });
  assert.equal(replay.status, 409, 'a consumed attempt cannot yield a second session');

  // A still-incomplete attempt has nothing to record.
  const open = await launch(training.id, { restart: true });
  const early = await grade({ trainingId: training.id, scormAttemptId: open.body.attemptId, reauth: { password: 'user123' } });
  assert.equal(early.status, 409);
  assert.match(early.body.error, /not reported completion/);

  // Another user's attempt is 404 — no existence oracle.
  const foreign = await grade({ trainingId: training.id, scormAttemptId: open.body.attemptId, reauth: { password: 'admin123' } }, adminToken);
  assert.equal(foreign.status, 404);

  // A garbage attempt id.
  assert.equal(
    (await grade({ trainingId: training.id, scormAttemptId: 'nope', reauth: { password: 'user123' } })).status,
    404,
  );
});

test('SYS-SCO-11 / SR-177 / VT-203: the exit and time completion rules gate server-side', async () => {
  // rule=exit: a clean terminate suffices even with no status.
  const { training: tExit, pkg: pkgExit } = await makeScormTraining('Rule Exit', await buildScorm12({}));
  await assignToMember([tExit.id]);
  await srv.request('PATCH', `/api/trainings/scorm-packages/${pkgExit.packageId}`, {
    token: adminToken,
    body: { completionRule: 'exit' },
  });

  const noTerminate = await runCourse(tExit.id, { 'cmi.core.lesson_location': 'slide-3' }, { terminate: false });
  const r1 = await grade({ trainingId: tExit.id, scormAttemptId: noTerminate, reauth: { password: 'user123' } });
  assert.equal(r1.status, 409, 'no terminate yet → not gradeable under exit');

  const terminated = await runCourse(tExit.id, { 'cmi.core.lesson_location': 'slide-9' }, { terminate: true });
  const r2 = await grade({ trainingId: tExit.id, scormAttemptId: terminated, reauth: { password: 'user123' } });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.passed, true, 'status-less course completes under the exit rule');

  // rule=time: gated on SERVER-clocked active seconds — a brand-new attempt has none.
  const { training: tTime, pkg: pkgTime } = await makeScormTraining('Rule Time', await buildScorm12({}));
  await assignToMember([tTime.id]);
  await srv.request('PATCH', `/api/trainings/scorm-packages/${pkgTime.packageId}`, {
    token: adminToken,
    body: { completionRule: 'time' },
  });
  const fresh = await runCourse(tTime.id, { 'cmi.core.session_time': '0010:00:00' }, { terminate: true });
  const r3 = await grade({ trainingId: tTime.id, scormAttemptId: fresh, reauth: { password: 'user123' } });
  assert.equal(r3.status, 409, 'a client-reported ten hours counts for nothing — the server clock decides');
});

test('SYS-SCO-10 / VT-204: an attempt against a superseded package build is refused', async () => {
  const { training: t, pkg } = await makeScormTraining('Superseded', await buildScorm12({}));
  await assignToMember([t.id]);
  const attemptId = await runCourse(t.id, { 'cmi.core.lesson_status': 'passed' });

  // Replace the package and publish the new build.
  const pkg2 = await upload(await buildScorm12({}));
  await srv.request('PUT', `/api/trainings/${t.id}`, { token: adminToken, body: { scormPackageId: pkg2.packageId } });
  await publishSilent(srv, t.id, adminToken);
  void pkg;

  const r = await grade({ trainingId: t.id, scormAttemptId: attemptId, reauth: { password: 'user123' } });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /course content has changed/);
});

test('SYS-SCO-10 / SR-178 / VT-205: quiz answers on a SCORM training are refused 409 — the zero-questions auto-pass hole is closed', async () => {
  const r = await grade({ trainingId: training.id, answers: [], reauth: { password: 'user123' } });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /SCORM course/);
  // And the mirror image: a scormAttemptId on a quiz training is a 400.
  const quiz = (await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: { name: 'Quiz Guard', questions: [{ text: 'Q', options: ['a', 'b'], correctIndices: [0] }] },
  })).body;
  await publishSilent(srv, quiz.id, adminToken);
  const rq = await grade({ trainingId: quiz.id, scormAttemptId: 'whatever', reauth: { password: 'user123' } });
  assert.equal(rq.status, 400);
});

test('SYS-SCO-10 / VT-204: a preview attempt can never be recorded', async () => {
  // The admin owns the training but is not assigned → launch forces preview.
  const l = await launch(training.id, {}, adminToken);
  assert.equal(l.status, 200);
  assert.equal(l.body.preview, true);
  await commit(l.body.attemptId, { values: { 'cmi.core.lesson_status': 'passed' }, terminate: true }, adminToken);
  const r = await grade({ trainingId: training.id, scormAttemptId: l.body.attemptId, reauth: { password: 'admin123' } }, adminToken);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /preview/);
});

test('SYS-SCO-11 / SR-182: a confirm-mode update is refused for a SCORM-backed training at publish AND at ack', async () => {
  // Stage a content change so publish-update has something to announce.
  const pkg2 = await upload(await buildScorm12({}));
  await srv.request('PUT', `/api/trainings/${training.id}`, { token: adminToken, body: { scormPackageId: pkg2.packageId } });
  const r = await srv.request('POST', `/api/trainings/${training.id}/publish-update`, {
    token: adminToken,
    body: {
      kind: 'notify',
      mode: 'confirm',
      deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
      emailSubject: 's',
      emailText: 't',
    },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /retake/);
  // The ack path is guarded too (records that predate the package).
  const ack = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: training.id, updateId: 'any' },
  });
  assert.equal(ack.status, 400);
  assert.match(ack.body.error, /retake/);
});

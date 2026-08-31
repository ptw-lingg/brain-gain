// Automated tests for the SCORM launch + content origin (SYS-SCO-05/06, traced to SR-177/SR-178):
// launch mints an attempt-bound token and a complete cmi seed; the content listener serves package
// bytes only under a live token (revoked the moment the attempt closes), answers Range requests,
// sets the isolation headers, holds no API and never allows cross-origin reads.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';
import { buildScorm12 } from './helpers/scormFixture.mjs';

let srv;
let adminToken;
let memberToken;
let memberId;
let training; // published, SCORM-backed, assigned to the member via a role
let pkg;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200);
  return r.body;
}

async function upload(bytes) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/scorm-packages?name=course.zip`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${adminToken}` },
    body: bytes,
  });
  assert.equal(res.status, 201);
  return res.json();
}

/** Assign the training to the member through a dedicated job role (launch requires assignment). */
async function assignToMember(trainingId) {
  const role = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: `scorm-role-${trainingId.slice(0, 8)}`, description: '', trainingIds: [trainingId] },
  });
  assert.equal(role.status, 201);
  const me = await srv.request('GET', `/api/users`, { token: adminToken });
  const member = me.body.find((u) => u.id === memberId);
  const put = await srv.request('PUT', `/api/users/${memberId}`, {
    token: adminToken,
    body: { roleIds: [...member.roleIds, role.body.id] },
  });
  assert.equal(put.status, 200);
}

const launch = (body, token = memberToken) =>
  srv.request('POST', '/api/sessions/scorm/launch', { token, body });

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  const member = await login('user@braingain.app', 'user123');
  memberToken = member.token;
  memberId = member.user.id;

  pkg = await upload(await buildScorm12({ extraFiles: { 'img/logo.svg': '<svg/>', 'media/clip.mp4': 'MP4-BYTES-0123456789' } }));
  const created = await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'SCORM Launch' } });
  training = created.body;
  await srv.request('PUT', `/api/trainings/${training.id}`, { token: adminToken, body: { scormPackageId: pkg.packageId } });
  await publishSilent(srv, training.id, adminToken);
  await assignToMember(training.id);
});

after(async () => srv.stop());

test('SYS-SCO-05 / SR-177 / VT-198: launch mints an attempt, a path token and a complete seeded cmi', async () => {
  const r = await launch({ trainingId: training.id });
  assert.equal(r.status, 200);
  assert.ok(r.body.attemptId);
  assert.equal(r.body.resumed, false);
  assert.equal(r.body.version, '1.2');
  assert.equal(r.body.preview, false);
  assert.ok(r.body.url.startsWith(`${srv.scormBaseUrl}/s/`), 'launch URL lives on the content origin');
  assert.ok(r.body.url.endsWith('/_lms/wrapper.html'));
  assert.match(r.body.nonce, /^[A-Za-z0-9_-]{20,}$/);
  // The seed is COMPLETE — reads are answered locally in the shim, so every element a course could
  // plausibly ask for must be present.
  assert.equal(r.body.cmi['cmi.core.lesson_status'], 'not attempted');
  assert.equal(r.body.cmi['cmi.core.entry'], '');
  assert.equal(r.body.cmi['cmi.core.student_id'], memberId, 'the UUID, never the email');
  assert.equal(r.body.cmi['cmi.student_data.mastery_score'], '80');
  assert.ok(r.body.readOnly.includes('cmi.core.student_id'));
});

test('SYS-SCO-05 / VT-198: the content origin serves the wrapper, the shim and package assets with correct types and Range support', async () => {
  const { body } = await launch({ trainingId: training.id });
  const base = body.url.replace(/_lms\/wrapper\.html$/, '');

  const wrapper = await fetch(body.url);
  assert.equal(wrapper.status, 200);
  assert.match(wrapper.headers.get('content-type'), /text\/html/);
  const html = await wrapper.text();
  assert.ok(html.includes('"nonce":'), 'config JSON is injected');
  assert.ok(!html.includes('__CFG_JSON__'));

  const shim = await fetch(`${base}_lms/scorm-api.js`);
  assert.equal(shim.status, 200);
  assert.match(shim.headers.get('content-type'), /javascript/);

  const svg = await fetch(`${base}img/logo.svg`);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg/);

  // Range: Chrome requires it to seek <video>.
  const clip = await fetch(`${base}media/clip.mp4`, { headers: { Range: 'bytes=4-8' } });
  assert.equal(clip.status, 206, 'partial content');
  assert.equal(await clip.text(), 'BYTES');
  assert.match(clip.headers.get('content-type'), /video\/mp4/);
});

test('SYS-SCO-12 / SR-181 / VT-199: content responses carry the isolation headers and no cookies/CORS; /api is dead on that origin', async () => {
  const { body } = await launch({ trainingId: training.id });
  const res = await fetch(body.url);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer', 'keeps the token out of Referer');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS, ever');
  assert.equal(res.headers.get('set-cookie'), null, 'no cookies, ever');
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp.includes("connect-src 'self'"), 'egress is locked down');
  assert.ok(csp.includes('frame-ancestors https://'), 'only the app may frame it');
  assert.ok(csp.includes('sandbox allow-scripts allow-same-origin'), 'CSP sandbox mirrors the iframe attribute');

  assert.equal((await fetch(`${srv.scormBaseUrl}/api/trainings`)).status, 404, 'no API on the content origin');
  assert.equal((await fetch(`${srv.scormBaseUrl}/`)).status, 404);
});

test('SYS-SCO-06 / SR-178 / VT-198: tampered, foreign and traversal requests are refused', async () => {
  const { body } = await launch({ trainingId: training.id });
  const base = body.url.replace(/_lms\/wrapper\.html$/, '');
  const token = body.url.split('/s/')[1].split('/')[0];

  assert.equal((await fetch(`${srv.scormBaseUrl}/s/garbage/_lms/wrapper.html`)).status, 403);
  assert.equal((await fetch(`${srv.scormBaseUrl}/s/${token}x/_lms/wrapper.html`)).status, 403, 'a bent signature dies');
  // An app JWT is NOT a launch token (different key family + typ claim).
  assert.equal((await fetch(`${srv.scormBaseUrl}/s/${memberToken}/_lms/wrapper.html`)).status, 403);
  assert.equal((await fetch(`${base}..%2f..%2fusers.json`)).status, 403, 'encoded traversal is contained');
  assert.equal((await fetch(`${base}nonexistent.html`)).status, 404);
});

test('SYS-SCO-06 / SR-178 / VT-198: the launch URL is revoked the moment its attempt closes', async () => {
  // A second launch of the same training resumes the SAME attempt, so use a dedicated one.
  const { body } = await launch({ trainingId: training.id });
  assert.equal((await fetch(body.url)).status, 200, 'alive while in-progress');

  // Terminate + fail the attempt via the commit endpoint (a failed close), then wait out the
  // content server's 2 s attempt cache.
  const commit = await srv.request('POST', `/api/sessions/scorm/attempts/${body.attemptId}/commit`, {
    token: memberToken,
    body: { values: { 'cmi.core.lesson_status': 'failed' }, terminate: true },
  });
  assert.equal(commit.status, 200);
  const graded = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: training.id, scormAttemptId: body.attemptId, reauth: { password: 'user123' } },
  });
  assert.equal(graded.status, 200);
  assert.equal(graded.body.passed, false, 'failed verdict → no pass');
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal((await fetch(body.url)).status, 403, 'the closed attempt revokes the URL');
});

test('SYS-SCO-05 / SR-177: launch guards — unpublished 409, quiz training 409, unassigned learner 403, admin preview', async () => {
  // Unpublished SCORM training.
  const pkg2 = await upload(await buildScorm12({}));
  const draft = (await srv.request('POST', '/api/trainings', { token: adminToken, body: { name: 'Unpublished SCORM' } })).body;
  await srv.request('PUT', `/api/trainings/${draft.id}`, { token: adminToken, body: { scormPackageId: pkg2.packageId } });
  assert.equal((await launch({ trainingId: draft.id }, adminToken)).status, 409);

  // A classic quiz training has no course to launch.
  const quiz = (await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: { name: 'Quiz Only', questions: [{ text: 'Q', options: ['a', 'b'], correctIndices: [0] }] },
  })).body;
  await publishSilent(srv, quiz.id, adminToken);
  assert.equal((await launch({ trainingId: quiz.id })).status, 409);

  // Publish the draft one — the member is NOT assigned to it → 403; the admin gets a PREVIEW.
  await publishSilent(srv, draft.id, adminToken);
  assert.equal((await launch({ trainingId: draft.id })).status, 403);
  const preview = await launch({ trainingId: draft.id }, adminToken);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.preview, true);
  assert.equal(preview.body.cmi['cmi.core.lesson_mode'], 'browse', 'a preview is visibly non-counting inside the course');
  assert.equal(preview.body.cmi['cmi.core.credit'], 'no-credit');
});

test('SYS-SCO-09 / SR-179 / VT-210: relaunching resumes the same attempt; restart abandons it', async () => {
  const first = await launch({ trainingId: training.id });
  const again = await launch({ trainingId: training.id });
  assert.equal(again.body.attemptId, first.body.attemptId, 'the open attempt is resumed');
  assert.equal(again.body.resumed, true);
  assert.equal(again.body.cmi['cmi.core.entry'], 'resume');

  const fresh = await launch({ trainingId: training.id, restart: true });
  assert.notEqual(fresh.body.attemptId, first.body.attemptId, 'restart starts over');
  assert.equal(fresh.body.resumed, false);
});

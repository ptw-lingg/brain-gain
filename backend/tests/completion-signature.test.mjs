// Automated tests for the completion signature (SYS-SES-12, traced to SR-173 / VT-187): completing
// a training — with or without test questions — requires the learner to re-confirm their identity
// at that moment, and the confirmation is recorded in the audit trail. Password accounts re-enter
// their password; SSO-linked accounts present a FRESH Microsoft ID token bound to their linked
// object id. The check runs against the ACTING account, so an impersonating admin cannot complete
// a training for someone else.
//
// Runs against a freshly-seeded backend pointed at the stub IdP (helpers/entra.mjs), so the
// Microsoft path exercises the REAL verification chain against locally minted RS256 tokens.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';
import { startFakeEntra } from './helpers/entra.mjs';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';
const SSO_OID = '33333333-3333-3333-3333-333333333333';

let idp;
let srv;
let adminToken;
let memberToken;
let memberId;
let quizTraining; // published v1, one question with correctIndices [0]
let noQuizTraining; // published v1, material only

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

const grade = (trainingId, body, token = memberToken) =>
  srv.request('POST', '/api/sessions/grade', { token, body: { trainingId, ...body } });

const listAudit = (qs) => srv.request('GET', `/api/audit?${qs}`, { token: adminToken });

const mint = (opts = {}) => idp.mintIdToken({ tenantId: TENANT, clientId: CLIENT, ...opts });

before(async () => {
  idp = await startFakeEntra();
  srv = await startTestServer({ env: { ENTRA_AUTHORITY_BASE: idp.base } });
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  const member = await login('user@braingain.app', 'user123');
  memberToken = member.token;
  memberId = member.user.id;

  // Enable SSO against the stub IdP (needed for the Microsoft signature path).
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { entra: { enabled: true, tenantId: TENANT, clientId: CLIENT, allowedDomains: ['braingain.app'] } },
  });
  assert.equal(put.status, 200);

  // Two published trainings with a KNOWN answer key (grading needs no role assignment).
  const quiz = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: {
      name: 'Signature Quiz',
      questions: [{ text: 'Q', options: ['right', 'wrong'], correctIndices: [0], type: 'single' }],
    },
  });
  assert.equal(quiz.status, 201);
  quizTraining = quiz.body;
  await publishSilent(srv, quizTraining.id, adminToken);

  const noQuiz = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: {
      name: 'Signature Confirmation Only',
      materials: [{ variants: [{ locale: 'en', label: 'Doc', url: 'https://example.com/doc' }] }],
      questions: [],
    },
  });
  assert.equal(noQuiz.status, 201);
  noQuizTraining = noQuiz.body;
  await publishSilent(srv, noQuizTraining.id, adminToken);
});

after(async () => {
  await srv?.stop();
  await idp?.stop();
});

// ───────────────────────── the signature gates every submission ─────────────────────────

test('SYS-SES-12 / SR-173 / VT-187: grading without credentials is refused (403), persists nothing and is audited', async () => {
  const res = await grade(quizTraining.id, { answers: [[0]] });
  assert.equal(res.status, 403, 'no reauth → refused before grading (403 — the session itself stays valid)');

  const sessions = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  assert.ok(!sessions.body.some((s) => s.trainingId === quizTraining.id), 'nothing persisted');

  const audit = await listAudit('action=login-failed');
  assert.ok(
    audit.body.entries.some((e) => /completion signature rejected \(missing credentials\)/.test(e.details ?? '')),
    'the refused signature is on the audit trail',
  );
});

test('SYS-SES-12 / VT-187: a wrong password is refused (403) and audited with the reason', async () => {
  const res = await grade(quizTraining.id, { answers: [[0]], reauth: { password: 'not-my-password' } });
  assert.equal(res.status, 403);
  const audit = await listAudit('action=login-failed');
  assert.ok(
    audit.body.entries.some(
      (e) => /completion signature rejected \(wrong password\)/.test(e.details ?? '') && e.entityName === 'user@braingain.app',
    ),
    'the wrong-password attempt names the acting account',
  );
});

test('SYS-SES-12 / SR-173 / VT-187: a correct password completes the training and the audit records signed: password', async () => {
  const res = await grade(quizTraining.id, { answers: [[0]], reauth: { password: 'user123' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.passed, true);

  const audit = await listAudit(`action=training-completed&q=${encodeURIComponent('Signature Quiz')}`);
  assert.equal(audit.body.total, 1);
  assert.match(audit.body.entries[0].details, /score 100% · signed: password/, 'the signature method is on record');
});

test('SYS-SES-12 / SR-173 / VT-187: a test-less training completes through the signed empty grading', async () => {
  const res = await grade(noQuizTraining.id, { answers: [], reauth: { password: 'user123' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.passed, true, 'zero questions still auto-pass — once signed');

  const audit = await listAudit(`action=training-completed&q=${encodeURIComponent('Signature Confirmation Only')}`);
  assert.equal(audit.body.total, 1);
  assert.match(audit.body.entries[0].details, /signed: password/);
});

// ───────────────────────── the signature binds to the ACTING account ─────────────────────────

test('SYS-SES-12 / SR-173 / VT-187: an impersonating admin cannot complete a training for the member', async () => {
  const imp = await srv.request('POST', `/api/auth/impersonate/${memberId}`, { token: adminToken });
  assert.equal(imp.status, 200, 'admin starts a view-as session');
  const impToken = imp.body.token;

  // The admin's OWN password does not sign for the member…
  const own = await grade(quizTraining.id, { answers: [[0]], reauth: { password: 'admin123' } }, impToken);
  assert.equal(own.status, 403, "the impersonator's credentials never sign the target's completion");

  // …only the acting (impersonated) account's credentials do.
  const target = await grade(quizTraining.id, { answers: [[0]], reauth: { password: 'user123' } }, impToken);
  assert.equal(target.status, 200, "the acting account's own password signs");
});

// ───────────────────────── the Microsoft path (stub IdP) ─────────────────────────

test('SYS-SES-12 / SR-173 / VT-187: an SSO-linked account signs with a fresh Microsoft token (signed: microsoft)', async () => {
  // Provision an SSO-only user via the real SSO login (domain allow-listed), with a FIXED oid.
  const ssoLogin = await srv.request('POST', '/api/auth/sso/entra', {
    body: { idToken: mint({ claims: { oid: SSO_OID, email: 'sso.user@braingain.app' } }) },
  });
  assert.equal(ssoLogin.status, 200, 'the SSO user is provisioned and signed in');
  assert.equal(ssoLogin.body.user.hasPassword, false, 'the identity payload flags the missing local password');
  const ssoToken = ssoLogin.body.token;

  // A password can never sign for a password-less account.
  const pw = await grade(quizTraining.id, { answers: [[0]], reauth: { password: 'anything' } }, ssoToken);
  assert.equal(pw.status, 403, 'no local password → the password path is refused');

  // A fresh token bound to the linked oid signs the completion.
  const fresh = await grade(
    quizTraining.id,
    { answers: [[0]], reauth: { entraIdToken: mint({ claims: { oid: SSO_OID, email: 'sso.user@braingain.app' } }) } },
    ssoToken,
  );
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.passed, true);

  const audit = await listAudit(`action=training-completed&q=${encodeURIComponent('Signature Quiz')}`);
  assert.ok(
    audit.body.entries.some((e) => /signed: microsoft/.test(e.details ?? '') && e.actor?.email === 'sso.user@braingain.app'),
    'the Microsoft-signed completion is on record',
  );
});

test('SYS-SES-12 / VT-187: a stale or foreign Microsoft token never signs a completion', async () => {
  const ssoLogin = await srv.request('POST', '/api/auth/sso/entra', {
    body: { idToken: mint({ claims: { oid: SSO_OID, email: 'sso.user@braingain.app' } }) },
  });
  const ssoToken = ssoLogin.body.token;

  // Valid but STALE (issued 15 minutes ago, not yet expired): a cached token is not a re-confirmation.
  const stale = await grade(
    quizTraining.id,
    {
      answers: [[0]],
      reauth: {
        entraIdToken: mint({
          claims: { oid: SSO_OID, email: 'sso.user@braingain.app', iat: Math.floor(Date.now() / 1000) - 900 },
          expiresIn: '30m',
        }),
      },
    },
    ssoToken,
  );
  assert.equal(stale.status, 403, 'stale token → refused');

  // Valid and fresh but for a DIFFERENT Microsoft account: someone else's identity never signs.
  const foreign = await grade(
    quizTraining.id,
    { answers: [[0]], reauth: { entraIdToken: mint({ claims: { email: 'other@braingain.app' } }) } },
    ssoToken,
  );
  assert.equal(foreign.status, 403, 'oid mismatch → refused');

  const audit = await listAudit('action=login-failed');
  assert.ok(
    audit.body.entries.some((e) => /stale Microsoft sign-in/.test(e.details ?? '')),
    'the stale-token refusal is audited',
  );
  assert.ok(
    audit.body.entries.some((e) => /Microsoft account does not match/.test(e.details ?? '')),
    'the mismatch refusal is audited',
  );
});

// ───────────────────────── a password account's FIRST Microsoft confirmation ─────────────────────────
// An account that has only ever used its password carries no Microsoft link. Its first Microsoft
// confirmation is accepted on the rule the SSO login applies when it links (same email), and the
// link is persisted so later confirmations bind to that Microsoft account (SYS-SES-12, SR-173).

test('SYS-SES-12 / SR-173 / VT-187: an unlinked password account confirms with Microsoft under its own email — the completion is signed and the account becomes linked', async () => {
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Pat Password', email: 'pat.password@braingain.app', password: 'patpass123', roleIds: [] },
  });
  assert.equal(created.status, 201);
  const pat = await login('pat.password@braingain.app', 'patpass123');
  const PAT_OID = '44444444-4444-4444-4444-444444444444';

  const first = await grade(
    quizTraining.id,
    { answers: [[0]], reauth: { entraIdToken: mint({ claims: { oid: PAT_OID, email: 'Pat.Password@braingain.app' } }) } },
    pat.token,
  );
  assert.equal(first.status, 200, `first Microsoft confirmation of a password account is accepted: ${JSON.stringify(first.body)}`);
  assert.equal(first.body.passed, true);

  const audit = await listAudit(`q=${encodeURIComponent('pat.password@braingain.app')}`);
  assert.ok(
    audit.body.entries.some((e) => /linked Microsoft account \(completion signature\)/.test(e.details ?? '')),
    'the link established by the signature is audited',
  );
  assert.ok(
    audit.body.entries.some((e) => e.action === 'training-completed' && /signed: microsoft/.test(e.details ?? '')),
    'the completion is recorded as Microsoft-signed',
  );

  // The account is linked now: the same email from a DIFFERENT Microsoft account no longer signs.
  const other = await grade(
    noQuizTraining.id,
    { answers: [], reauth: { entraIdToken: mint({ claims: { email: 'pat.password@braingain.app' } }) } },
    pat.token,
  );
  assert.equal(other.status, 403, 'after linking, only the linked Microsoft account signs');
  // …while the linked one still does.
  const again = await grade(
    noQuizTraining.id,
    { answers: [], reauth: { entraIdToken: mint({ claims: { oid: PAT_OID, email: 'pat.password@braingain.app' } }) } },
    pat.token,
  );
  assert.equal(again.status, 200, 'the linked Microsoft account keeps signing');
});

test('SYS-SES-12 / VT-187: an unlinked account is refused a Microsoft identity with another email, or one already linked to a different user', async () => {
  // Make sure the SSO user (SSO_OID) exists — a Microsoft identity that belongs to someone else.
  const sso = await srv.request('POST', '/api/auth/sso/entra', {
    body: { idToken: mint({ claims: { oid: SSO_OID, email: 'sso.user@braingain.app' } }) },
  });
  assert.equal(sso.status, 200);

  // The seeded member has a password and no link. Someone else's email never signs for them…
  const otherEmail = await grade(
    noQuizTraining.id,
    { answers: [], reauth: { entraIdToken: mint({ claims: { email: 'someone.else@braingain.app' } }) } },
  );
  assert.equal(otherEmail.status, 403, 'different email → refused');
  // …and neither does a Microsoft account that is already linked to another BrainGain user, even
  // when its token claims the member's email.
  const takenOid = await grade(
    noQuizTraining.id,
    { answers: [], reauth: { entraIdToken: mint({ claims: { oid: SSO_OID, email: 'user@braingain.app' } }) } },
  );
  assert.equal(takenOid.status, 403, 'oid linked to a different user → refused');

  const member = await srv.request('GET', `/api/users/${memberId}`, { token: adminToken });
  assert.equal(member.body.hasPassword, true);
  const audit = await listAudit('action=login-failed');
  assert.ok(
    audit.body.entries.some((e) => /linked to a different user/.test(e.details ?? '')),
    'the taken-identity refusal is audited with its reason',
  );
});

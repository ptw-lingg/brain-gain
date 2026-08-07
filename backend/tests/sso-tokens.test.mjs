// Automated verification of the full Entra SSO token path — the parts that previously required a real
// IdP. A stub IdP (helpers/entra.mjs) publishes a JWKS and mints RS256 ID tokens; the backend is booted
// with ENTRA_AUTHORITY_BASE pointing at it, so verifyEntraIdToken() runs its REAL validation chain
// (RS256 pin, kid → JWKS key, signature, aud, iss, exp, tid, claim extraction) against local tokens.
//
// Requirements covered:
//   SYS-SSO-04 / VT-009  ID-token validation: alg pin, signature, audience, issuer, expiry, tenant.
//   SYS-SSO-05 / VT-009  Claim extraction (oid, email/preferred_username, name); missing → rejected.
//   SYS-SSO-06 / VT-009  Link/provision ladder: oid match → email link (409 takeover guard) →
//                        domain auto-create → 403 outside the allow-list.
//   SYS-SSO-07 / SR-006  On success the same app JWT + SafeUser shape as password login is issued.
//
// Seeded fixtures (helpers/server.mjs): admin@braingain.app/admin123, user@braingain.app/user123.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, decodeJwt } from './helpers/server.mjs';
import { startFakeEntra } from './helpers/entra.mjs';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';

let idp;
let srv;

before(async () => {
  idp = await startFakeEntra();
  srv = await startTestServer({ env: { ENTRA_AUTHORITY_BASE: idp.base } });

  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.equal(login.status, 200, 'admin can log in');

  // Enable SSO through the in-app settings path, exactly as an admin would.
  const put = await srv.request('PUT', '/api/settings', {
    token: login.body.token,
    body: { entra: { enabled: true, tenantId: TENANT, clientId: CLIENT, allowedDomains: ['braingain.app'] } },
  });
  assert.equal(put.status, 200, 'admin enabled SSO against the stub IdP');
});

after(async () => {
  await srv?.stop();
  await idp?.stop();
});

const sso = (idToken) => srv.request('POST', '/api/auth/sso/entra', { body: { idToken } });
const mint = (opts = {}) => idp.mintIdToken({ tenantId: TENANT, clientId: CLIENT, ...opts });

// ───────────────────────── SYS-SSO-04: the validation chain accepts only a fully valid token ─────────────────────────

test('SYS-SSO-04 / SYS-SSO-07 / SR-006 / VT-009: a valid RS256 token signs the user in with the same app JWT shape as password login', async () => {
  const res = await sso(mint({ claims: { email: 'user@braingain.app' } }));
  assert.equal(res.status, 200, 'a fully valid token is accepted');
  assert.ok(res.body.token, 'an app JWT is issued');
  assert.equal(res.body.user.email, 'user@braingain.app', 'the SafeUser payload identifies the account');
  assert.equal(res.body.user.passwordHash, undefined, 'no credential material leaks in the user payload');
  assert.equal(res.body.user.entraOid, undefined, 'the Entra object id is not exposed to the browser');
  const claims = decodeJwt(res.body.token);
  assert.ok(claims.sub || claims.userId || claims.id, 'the app JWT carries the user identity like a password login');
});

test('SYS-SSO-04 / VT-009: a token for a different audience (clientId) is rejected with 401', async () => {
  const res = await sso(mint({ audience: '99999999-9999-9999-9999-999999999999', claims: { email: 'user@braingain.app' } }));
  assert.equal(res.status, 401, 'wrong aud → 401');
  assert.equal(res.body.token, undefined);
});

test('SYS-SSO-04 / VT-009: a token from a different issuer is rejected with 401', async () => {
  const res = await sso(mint({ issuer: `${idp.base}/99999999-9999-9999-9999-999999999999/v2.0`, claims: { email: 'user@braingain.app' } }));
  assert.equal(res.status, 401, 'wrong iss → 401');
});

test('SYS-SSO-04 / VT-009: a token whose tid claim is another tenant is rejected with 401', async () => {
  // iss is correct (so jwt.verify passes) but the tid claim points elsewhere — the explicit tenant
  // check must still refuse it (essential if the authority ever became /common).
  const res = await sso(mint({ claims: { tid: '99999999-9999-9999-9999-999999999999', email: 'user@braingain.app' } }));
  assert.equal(res.status, 401, 'foreign tid → 401');
});

test('SYS-SSO-04 / VT-009: an expired token is rejected with 401 (beyond the clock tolerance)', async () => {
  const res = await sso(mint({ expiresIn: '-20m', claims: { email: 'user@braingain.app' } }));
  assert.equal(res.status, 401, 'expired beyond the 5-minute skew → 401');
});

test('SYS-SSO-04 / VT-009: algorithm confusion (HS256 token) is rejected with 401 before any key lookup', async () => {
  const res = await sso(mint({ algorithm: 'HS256', key: 'not-an-rsa-key', claims: { email: 'user@braingain.app' } }));
  assert.equal(res.status, 401, 'non-RS256 alg is pinned out');
});

test('SYS-SSO-04 / VT-009: a token signed with an unpublished key (unknown kid) is never accepted', async () => {
  const res = await sso(mint({ keyid: 'unknown-kid', claims: { email: 'user@braingain.app' } }));
  assert.ok(res.status >= 400, `unknown kid is not accepted (got ${res.status})`);
  assert.equal(res.body?.token, undefined, 'no app token issued');
});

// ───────────────────────── SYS-SSO-05: claim extraction ─────────────────────────

test('SYS-SSO-05 / VT-009: a token without an oid claim is rejected with 401', async () => {
  const res = await sso(mint({ claims: { oid: null, email: 'user@braingain.app' } }));
  assert.equal(res.status, 401, 'missing oid → 401');
});

test('SYS-SSO-05 / VT-009: a token without email falls back to preferred_username; with neither it is rejected', async () => {
  // A fresh allow-listed identity: the fallback email is what the provisioning ladder receives.
  const viaPreferred = await sso(mint({ claims: { email: null, preferred_username: 'preferred.user@braingain.app' } }));
  assert.equal(viaPreferred.status, 200, 'preferred_username substitutes for email');
  assert.equal(viaPreferred.body.user.email, 'preferred.user@braingain.app', 'the fallback claim becomes the account email');
  const neither = await sso(mint({ claims: { email: null } }));
  assert.equal(neither.status, 401, 'no email and no preferred_username → 401');
});

// ───────────────────────── SYS-SSO-06: link / provision ladder ─────────────────────────

test('SYS-SSO-06 / VT-009: first SSO sign-in links the Entra account to the existing user by email, then oid wins over email', async () => {
  const oid = 'aaaaaaaa-1111-2222-3333-444444444444';
  const link = await sso(mint({ claims: { oid, email: 'trainer@braingain.app' } }));
  assert.equal(link.status, 200, 'email match links the account');
  assert.equal(link.body.user.email, 'trainer@braingain.app');
  assert.equal(link.body.user.isTrainer, true, 'linking never touches roles — the trainer stays a trainer');

  // Same oid, different (even non-allow-listed) email: the oid link takes precedence over email.
  const byOid = await sso(mint({ claims: { oid, email: 'renamed.trainer@elsewhere.example' } }));
  assert.equal(byOid.status, 200, 'a linked oid signs in regardless of the current email claim');
  assert.equal(byOid.body.user.email, 'trainer@braingain.app', 'it is the linked account, not a new one');
});

test('SYS-SSO-06 / VT-009: an email already linked to a different Entra account is refused with 409 (takeover guard)', async () => {
  const res = await sso(mint({ claims: { oid: 'bbbbbbbb-1111-2222-3333-444444444444', email: 'trainer@braingain.app' } }));
  assert.equal(res.status, 409, 'second Entra identity cannot take over a linked email');
  assert.equal(res.body.token, undefined);
});

test('SYS-SSO-06 / SYS-SSO-07 / VT-009: an unknown allow-listed email is auto-provisioned as a plain member', async () => {
  const res = await sso(mint({ claims: { oid: 'cccccccc-1111-2222-3333-444444444444', email: 'new.colleague@braingain.app', name: 'New Colleague' } }));
  assert.equal(res.status, 200, 'allow-listed domain auto-provisions');
  assert.equal(res.body.user.email, 'new.colleague@braingain.app');
  assert.equal(res.body.user.name, 'New Colleague');
  assert.equal(res.body.user.isAdmin, false, 'provisioned users are never admins');
  assert.equal(res.body.user.isTrainer, false, 'provisioned users are never trainers');
});

test('SYS-SSO-06 / VT-009: an email outside the domain allow-list is refused with 403 and no account is created', async () => {
  const res = await sso(mint({ claims: { oid: 'dddddddd-1111-2222-3333-444444444444', email: 'intruder@evil.example' } }));
  assert.equal(res.status, 403, 'non-allow-listed domain → 403');
  // Signing in again still fails identically — nothing was persisted for the refused identity.
  const again = await sso(mint({ claims: { oid: 'dddddddd-1111-2222-3333-444444444444', email: 'intruder@evil.example' } }));
  assert.equal(again.status, 403);
});

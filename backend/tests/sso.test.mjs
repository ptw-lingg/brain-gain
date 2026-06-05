// Automated (API-observable) tests for Microsoft Entra ID SSO.
//
// Requirements covered (the parts exercisable WITHOUT a real Entra IdP/JWKS):
//   SYS-SSO-02 / VT-007  GET /api/auth/sso/config is public and returns { enabled:false } when unconfigured.
//   SYS-SSO-03 / VT-007  POST /api/auth/sso/entra → 503 when SSO is unconfigured; 400 when idToken missing/invalid.
//   SYS-SSO-08 / SR-007  When SSO is off the app stays password-only (config off, entra endpoint 503, password login still works).
//
// Traces to stakeholder reqs SR-006 (sign in with Entra), SR-007 (optional/configurable), SR-010 (keep password login).
//
// The full token-verification + auto-provision + account-linking + domain-restriction logic
// (SYS-SSO-04/05/06/07 / VT-009) needs a real Entra IdP signing tokens against published JWKS,
// so those are documented as MANUAL procedures in requirements/manual-tests/sso.md.
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app / admin123     (admin)
//   user@braingain.app  / user123      (member)
//   settings: passThreshold 0.8; Entra SSO disabled (entra.enabled = false) by default.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;

before(async () => {
  srv = await startTestServer();

  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.equal(login.status, 200, 'admin can log in');
  adminToken = login.body.token;
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-SSO-02 / VT-007 : public /sso/config, disabled by default ─────────────────────────

test('SYS-SSO-02 / VT-007: GET /api/auth/sso/config is public and returns { enabled:false } on the seeded default', async () => {
  // No Authorization header — the login page must read this before the user has any session.
  const res = await srv.request('GET', '/api/auth/sso/config');
  assert.equal(res.status, 200, 'config endpoint is reachable without auth');
  assert.equal(res.body.enabled, false, 'SSO is disabled by default (seeded settings)');
  // When disabled the response carries no clientId/authority (nothing for the browser to bootstrap).
  assert.equal(res.body.clientId, undefined, 'no clientId leaked while disabled');
  assert.equal(res.body.authority, undefined, 'no authority leaked while disabled');
});

// ───────────────────────── SYS-SSO-03 / VT-007 : POST /sso/entra guards ─────────────────────────

test('SYS-SSO-03 / VT-007: POST /api/auth/sso/entra returns 503 when SSO is unconfigured', async () => {
  // The config check runs before anything else, so even a well-formed body gets 503 while disabled.
  const res = await srv.request('POST', '/api/auth/sso/entra', { body: { idToken: 'anything' } });
  assert.equal(res.status, 503, 'unconfigured SSO is unavailable, not a 400/401');
  assert.match(res.body.error, /not configured/i);
});

test('SYS-SSO-03: POST /api/auth/sso/entra returns 503 even with no body while SSO is unconfigured', async () => {
  const res = await srv.request('POST', '/api/auth/sso/entra');
  assert.equal(res.status, 503, 'config gate precedes the idToken check');
});

// ───────────────────────── SYS-SSO-08 / SR-007 : graceful-off keeps the app password-only ─────────────────────────

test('SYS-SSO-08 / SR-007: with SSO off, password login behaves exactly as a password-only app', async () => {
  const ok = await srv.request('POST', '/api/auth/login', {
    body: { email: 'user@braingain.app', password: 'user123' },
  });
  assert.equal(ok.status, 200, 'seeded member can still sign in with a password');
  assert.ok(ok.body.token, 'password login still issues an app token');

  const bad = await srv.request('POST', '/api/auth/login', {
    body: { email: 'user@braingain.app', password: 'wrong' },
  });
  assert.equal(bad.status, 401, 'bad password still rejected — SSO being off changes nothing');
});

// ───────── SYS-SSO-03 (idToken guard) : exercise the 400/401 branches by configuring SSO ─────────
// The 400 (missing idToken) and 401 (invalid/unverifiable token) branches only run once SSO is
// "configured" (enabled + tenantId + clientId). We enable it via PUT /api/settings (admin), which is
// the in-app configuration path (SR-008 / SYS-SET-02). No real Entra tenant is reachable, so a token
// can never actually verify here — but the guard branches before/around verification are observable.

test('SYS-SSO-03 / VT-007: once configured, POST /api/auth/sso/entra returns 400 when idToken is missing/invalid', async () => {
  // Configure SSO in-app (a fake but well-formed tenant/client; no secret involved).
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: {
      entra: {
        enabled: true,
        tenantId: '11111111-1111-1111-1111-111111111111',
        clientId: '22222222-2222-2222-2222-222222222222',
        allowedDomains: ['braingain.app'],
      },
    },
  });
  assert.equal(put.status, 200, 'admin can enable SSO from Settings');

  // Now the config gate passes, so the request reaches the idToken validation.
  const sanity = await srv.request('GET', '/api/auth/sso/config');
  assert.equal(sanity.body.enabled, true, 'config now reports enabled with clientId/authority');
  assert.ok(sanity.body.clientId, 'configured response exposes the (non-secret) clientId');
  assert.ok(sanity.body.authority, 'configured response exposes the authority URL');

  const missing = await srv.request('POST', '/api/auth/sso/entra', { token: undefined, body: {} });
  assert.equal(missing.status, 400, 'no idToken → 400');
  assert.match(missing.body.error, /idToken is required/i);

  const empty = await srv.request('POST', '/api/auth/sso/entra', { body: { idToken: '' } });
  assert.equal(empty.status, 400, 'empty idToken → 400');

  const nonString = await srv.request('POST', '/api/auth/sso/entra', { body: { idToken: 12345 } });
  assert.equal(nonString.status, 400, 'non-string idToken → 400');
});

test('SYS-SSO-03/04 / VT-007: a malformed idToken is rejected (cannot be verified) — never accepted', async () => {
  // SSO is enabled from the previous test (same server instance). A garbage token can't be a valid
  // RS256 Entra token, so verification fails. We assert only that it is NOT accepted as a sign-in
  // (no 2xx, no token issued); the precise non-success code (401 token-content vs 5xx infra such as a
  // JWKS lookup that can't reach the fake tenant) depends on unreachable Microsoft infra and is not pinned.
  const res = await srv.request('POST', '/api/auth/sso/entra', { body: { idToken: 'not.a.jwt' } });
  assert.ok(res.status >= 400, 'a bogus idToken is never accepted');
  assert.equal(res.body?.token, undefined, 'no app token is issued for an unverifiable idToken');
});

// Automated tests for the Settings requirement area (SYS areas: SET):
//   SYS-SET-01  GET /api/settings (any authenticated user) returns the full Settings
//   SYS-SET-02  PUT /api/settings (admin) partial merge: clamp passThreshold 0.5–1, coerce/sanitize
//               the Entra SSO config, and save threshold & SSO independently
//   SYS-SET-03  Settings page cards — API-observable round-trip (UI itself is e2e/manual)
// Stakeholder reqs: SR-080 (global pass threshold), SR-008 (configure SSO in-app), SR-081 (manage SSO
// from Settings). Validation tests: VT-007/VT-008 (SSO config independence) and VT-080 (threshold).
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app   / admin123    (isAdmin)
//   trainer@braingain.app / trainer123  (isTrainer)
//   user@braingain.app    / user123     (plain member)
//   settings: passThreshold 0.8; Entra SSO disabled.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;

async function login(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `${email} can log in`);
  return res.body.token;
}

before(async () => {
  srv = await startTestServer();
  adminToken = await login('admin@braingain.app', 'admin123');
  trainerToken = await login('trainer@braingain.app', 'trainer123');
  memberToken = await login('user@braingain.app', 'user123');
});

after(async () => { await srv?.stop(); });

// ───────────────────────────── SYS-SET-01: GET /api/settings ─────────────────────────────

test('SYS-SET-01 / SR-080: GET /settings returns the full seeded Settings (defaults applied)', async () => {
  const res = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(res.status, 200);
  // Seed default pass threshold.
  assert.equal(res.body.passThreshold, 0.8, 'seeded passThreshold is 0.8');
  // entra defaults are backfilled (SYS-DATA-06): disabled, empty ids, empty allowed domains.
  assert.ok(res.body.entra, 'entra config is present');
  assert.equal(res.body.entra.enabled, false, 'SSO disabled by default');
  assert.equal(res.body.entra.tenantId, '');
  assert.equal(res.body.entra.clientId, '');
  assert.deepEqual(res.body.entra.allowedDomains, []);
  // tls default is backfilled to null when no cert metadata is stored.
  assert.ok('tls' in res.body, 'tls key is present (default-backfilled)');
});

test('SYS-SET-01 / SR-080: GET /settings is allowed for any authenticated user (member, trainer)', async () => {
  for (const [label, token] of [['member', memberToken], ['trainer', trainerToken]]) {
    const res = await srv.request('GET', '/api/settings', { token });
    assert.equal(res.status, 200, `${label} can read settings (client needs the threshold)`);
    assert.equal(typeof res.body.passThreshold, 'number');
  }
});

test('SYS-SET-01 / SR-104: GET /settings without a token is rejected (401)', async () => {
  const res = await srv.request('GET', '/api/settings');
  assert.equal(res.status, 401, 'authenticate middleware blocks anonymous reads');
});

// ───────────────────────────── SYS-SET-02: PUT /api/settings (admin) ─────────────────────────────

test('SYS-SET-02 / VT-080: admin sets the global pass threshold and it persists', async () => {
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { passThreshold: 0.7 },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.passThreshold, 0.7, 'PUT echoes the new threshold');

  const get = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(get.body.passThreshold, 0.7, 'threshold persisted across a fresh read');
});

test('SYS-SET-02 / SR-080: passThreshold is clamped to 0.5–1.0', async () => {
  const tooLow = await srv.request('PUT', '/api/settings', { token: adminToken, body: { passThreshold: 0.1 } });
  assert.equal(tooLow.status, 200);
  assert.equal(tooLow.body.passThreshold, 0.5, 'below-minimum is clamped up to 0.5');

  const tooHigh = await srv.request('PUT', '/api/settings', { token: adminToken, body: { passThreshold: 2 } });
  assert.equal(tooHigh.status, 200);
  assert.equal(tooHigh.body.passThreshold, 1, 'above-maximum is clamped down to 1.0');

  // restore a sane mid value for later independence checks
  await srv.request('PUT', '/api/settings', { token: adminToken, body: { passThreshold: 0.8 } });
});

test('SYS-SET-02 / SR-080: a non-numeric passThreshold is rejected with 400', async () => {
  const res = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { passThreshold: 'not-a-number' },
  });
  assert.equal(res.status, 400, 'non-finite threshold → 400');
});

test('SYS-SET-02 / SR-008 / VT-008: admin saves the Entra SSO config (coerce, trim, sanitize domains)', async () => {
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: {
      entra: {
        enabled: 1, // truthy non-boolean → coerced to true
        tenantId: '  tenant-123  ', // trimmed
        clientId: '  client-456  ', // trimmed
        allowedDomains: '  Example.com , PTWdosimetry.com ,, ', // CSV string, trimmed/lowered/de-empty'd
      },
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.entra.enabled, true, 'enabled coerced to boolean true');
  assert.equal(put.body.entra.tenantId, 'tenant-123', 'tenantId trimmed');
  assert.equal(put.body.entra.clientId, 'client-456', 'clientId trimmed');
  assert.deepEqual(
    put.body.entra.allowedDomains,
    ['example.com', 'ptwdosimetry.com'],
    'CSV domains parsed, trimmed, lower-cased, empties dropped',
  );

  const get = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.deepEqual(get.body.entra.allowedDomains, ['example.com', 'ptwdosimetry.com'], 'SSO config persisted');
});

test('SYS-SET-02 / SR-008: allowedDomains also accepts an array', async () => {
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { entra: { enabled: false, tenantId: 't', clientId: 'c', allowedDomains: ['A.com', ' b.com '] } },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.entra.allowedDomains, ['a.com', 'b.com'], 'array domains sanitized too');
});

test('SYS-SET-02 / VT-008: saving SSO does not change the pass threshold, and vice-versa', async () => {
  // Establish a known threshold.
  await srv.request('PUT', '/api/settings', { token: adminToken, body: { passThreshold: 0.65 } });

  // Save ONLY the SSO config — threshold must be untouched.
  await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { entra: { enabled: true, tenantId: 'tid', clientId: 'cid', allowedDomains: ['only.com'] } },
  });
  let get = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(get.body.passThreshold, 0.65, 'threshold unchanged when only SSO is saved');
  assert.equal(get.body.entra.enabled, true, 'SSO saved');

  // Save ONLY the threshold — SSO config must be untouched.
  await srv.request('PUT', '/api/settings', { token: adminToken, body: { passThreshold: 0.9 } });
  get = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(get.body.passThreshold, 0.9, 'threshold updated');
  assert.deepEqual(get.body.entra.allowedDomains, ['only.com'], 'SSO config unchanged when only threshold is saved');
  assert.equal(get.body.entra.tenantId, 'tid', 'SSO tenantId preserved');
});

test('SYS-SET-02 / SR-003: PUT /settings requires admin — a member token is forbidden (403)', async () => {
  const res = await srv.request('PUT', '/api/settings', {
    token: memberToken,
    body: { passThreshold: 0.5 },
  });
  assert.equal(res.status, 403, 'requireAdmin blocks non-admins');
});

test('SYS-SET-02 / SR-003: PUT /settings requires admin — a trainer token is forbidden (403)', async () => {
  const res = await srv.request('PUT', '/api/settings', {
    token: trainerToken,
    body: { passThreshold: 0.5 },
  });
  assert.equal(res.status, 403, 'trainer is not an admin');
});

test('SYS-SET-02 / SR-003: PUT /settings without a token is rejected (401)', async () => {
  const res = await srv.request('PUT', '/api/settings', { body: { passThreshold: 0.5 } });
  assert.equal(res.status, 401);
});

// ───────────────────────────── SYS-SET-03: round-trip the page would perform ─────────────────────────────

test('SYS-SET-03 / SR-081: the threshold round-trip the Settings page performs persists', async () => {
  // The Settings page sends passThreshold = pct/100. Simulate the 75% slider position.
  const put = await srv.request('PUT', '/api/settings', { token: adminToken, body: { passThreshold: 0.75 } });
  assert.equal(put.status, 200);
  assert.equal(put.body.passThreshold, 0.75);

  // The page reload re-fetches GET /settings and renders Math.round(passThreshold * 100) = 75%.
  const get = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(Math.round(get.body.passThreshold * 100), 75, 'page would re-render 75%');
});

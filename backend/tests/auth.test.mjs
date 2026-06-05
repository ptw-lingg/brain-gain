// Automated tests for the Authentication & Authorization requirement area:
//   SYS-AUTH-01  POST /api/auth/login (case-insensitive match, 400/401, { token, user })
//   SYS-AUTH-04  GET /api/auth/me rehydrate
//   SYS-AUTH-07  SSO-only / passwordless users cannot password-login (401)
//   SYS-AC-01    authenticate (401) / requireAdmin / requireTrainerOrAdmin / requireAdminOrOwner
//   SYS-AC-02    admin-only mutations on /api/users, /api/roles, PUT /api/settings
//   SYS-AC-03    training guards: POST trainer-or-admin; PUT/DELETE admin-or-owner; reorder admin
//   SYS-DATA-07  SafeUser strips passwordHash / entraOid
// Validation tests: VT-001 (login), VT-003/VT-004 (server-side admin enforcement),
//   VT-007 (SSO graceful-off), VT-045 (trainer ownership), VT-104/VT-105 (server enforcement / no secrets).
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app   / admin123    (isAdmin)
//   trainer@braingain.app / trainer123  (isTrainer; owns the two seeded trainings)
//   user@braingain.app    / user123     (plain member; holds "Lab Technician" → 2 trainings)
//   settings: passThreshold 0.8; Entra SSO disabled.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, decodeJwt } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken; // owns the seeded trainings
let memberToken;
let ownedTrainingId; // a training owned by the seeded trainer
let secondTrainerToken; // a trainer who owns nothing (to prove the non-owner 403 path)

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `${email} can log in`);
  return res.body.token;
}

before(async () => {
  srv = await startTestServer();

  adminToken = await loginToken('admin@braingain.app', 'admin123');
  trainerToken = await loginToken('trainer@braingain.app', 'trainer123');
  memberToken = await loginToken('user@braingain.app', 'user123');

  // Pick a training the seeded trainer owns (admin sees all and gets the full shape with ownerId).
  const trainings = await srv.request('GET', '/api/trainings', { token: adminToken });
  assert.equal(trainings.status, 200);
  const trainerId = decodeJwt(trainerToken).id;
  const owned = trainings.body.find((t) => t.ownerId === trainerId);
  assert.ok(owned, 'the seeded trainer owns at least one training');
  ownedTrainingId = owned.id;

  // A second trainer, created by the admin, who owns NO trainings — used to prove that
  // requireAdminOrOwner rejects a trainer mutating a training they don't own (403, not 401).
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Other Trainer', email: 'trainer2@test.local', password: 'pw123456', isTrainer: true },
  });
  assert.equal(created.status, 201, 'admin creates a second trainer');
  secondTrainerToken = await loginToken('trainer2@test.local', 'pw123456');
});

after(async () => { await srv?.stop(); });

// ───────────────────────────── SYS-AUTH-01 / VT-001 : password login ─────────────────────────────

test('SYS-AUTH-01 / VT-001: valid credentials return { token, user } and a usable JWT', async () => {
  const res = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.equal(res.status, 200);
  assert.ok(typeof res.body.token === 'string' && res.body.token.length > 0, 'returns a token');
  assert.equal(res.body.user.email, 'admin@braingain.app');
  const claims = decodeJwt(res.body.token);
  assert.equal(claims.isAdmin, true, 'token payload carries the access-level flags');
  assert.equal(claims.email, 'admin@braingain.app');
});

test('SYS-AUTH-01 / VT-001: email is matched case-insensitively', async () => {
  const res = await srv.request('POST', '/api/auth/login', {
    body: { email: 'ADMIN@BrainGain.App', password: 'admin123' },
  });
  assert.equal(res.status, 200, 'mixed-case email still logs in');
  assert.equal(res.body.user.email, 'admin@braingain.app');
});

test('SYS-AUTH-01 / VT-001: a wrong password is rejected with 401', async () => {
  const res = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'definitely-wrong' },
  });
  assert.equal(res.status, 401);
  assert.ok(!res.body.token, 'no token issued on bad credentials');
});

test('SYS-AUTH-01 / VT-001: missing fields return 400', async () => {
  const noPassword = await srv.request('POST', '/api/auth/login', { body: { email: 'admin@braingain.app' } });
  assert.equal(noPassword.status, 400);
  const empty = await srv.request('POST', '/api/auth/login', { body: {} });
  assert.equal(empty.status, 400);
});

// ───────────────────────────── SYS-AUTH-07 / VT-001 : no user enumeration / passwordless ─────────
// SSO-only users have no passwordHash; the same guard also covers an entirely unknown email.
// Both return the same 401 — proven over the API; the passwordless branch itself is documented in
// requirements/manual-tests/auth.md (SSO-only accounts can only be created via the SSO flow).

test('SYS-AUTH-07 / VT-001: an unknown email returns 401 (no account / no password to verify)', async () => {
  const res = await srv.request('POST', '/api/auth/login', {
    body: { email: 'nobody@braingain.app', password: 'whatever' },
  });
  assert.equal(res.status, 401);
});

// ───────────────────────────── SYS-AUTH-04 : GET /api/auth/me ─────────────────────────────

test('SYS-AUTH-04: GET /api/auth/me returns the current user when authenticated', async () => {
  const res = await srv.request('GET', '/api/auth/me', { token: memberToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'user@braingain.app');
  assert.equal(res.body.isAdmin, false);
});

test('SYS-AC-01: GET /api/auth/me without a token returns 401 (authenticate guard)', async () => {
  const res = await srv.request('GET', '/api/auth/me');
  assert.equal(res.status, 401);
});

test('SYS-AC-01: a malformed/garbage bearer token returns 401', async () => {
  const res = await srv.request('GET', '/api/auth/me', { token: 'not-a-real-jwt' });
  assert.equal(res.status, 401);
});

// ───────────────────────────── SYS-DATA-07 / VT-105 : SafeUser strips secrets ─────────────────────

test('SYS-DATA-07 / VT-105: login, /me and /users never expose passwordHash or entraOid', async () => {
  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.ok(!('passwordHash' in login.body.user), 'login user has no passwordHash');
  assert.ok(!('entraOid' in login.body.user), 'login user has no entraOid');

  const me = await srv.request('GET', '/api/auth/me', { token: memberToken });
  assert.ok(!('passwordHash' in me.body) && !('entraOid' in me.body), '/me strips secrets');

  const users = await srv.request('GET', '/api/users', { token: adminToken });
  for (const u of users.body) {
    assert.ok(!('passwordHash' in u), 'no passwordHash leaked in /users');
    assert.ok(!('entraOid' in u), 'no entraOid leaked in /users');
  }
});

// ───────────────────────────── SYS-AC-02 / VT-003 / VT-004 / VT-104 : requireAdmin ─────────────────

test('SYS-AC-02 / VT-003: GET /api/users requires admin (member → 403, trainer → 403)', async () => {
  const asMember = await srv.request('GET', '/api/users', { token: memberToken });
  assert.equal(asMember.status, 403);
  const asTrainer = await srv.request('GET', '/api/users', { token: trainerToken });
  assert.equal(asTrainer.status, 403);
  const asAdmin = await srv.request('GET', '/api/users', { token: adminToken });
  assert.equal(asAdmin.status, 200, 'admin is allowed through');
});

test('SYS-AC-01: /api/users without a token returns 401, not 403 (authenticate runs first)', async () => {
  const res = await srv.request('GET', '/api/users');
  assert.equal(res.status, 401);
});

test('SYS-AC-02 / VT-003: POST /api/users (create) requires admin → member 403', async () => {
  const res = await srv.request('POST', '/api/users', {
    token: memberToken,
    body: { name: 'Hacker', email: 'hacker@test.local', password: 'pw123456' },
  });
  assert.equal(res.status, 403);
});

test('SYS-AC-02 / VT-003: role mutations require admin (member POST/PUT/DELETE → 403; GET allowed)', async () => {
  const post = await srv.request('POST', '/api/roles', { token: memberToken, body: { name: 'Sneaky Role' } });
  assert.equal(post.status, 403);
  const put = await srv.request('PUT', '/api/roles/some-id', { token: memberToken, body: { name: 'x' } });
  assert.equal(put.status, 403);
  const del = await srv.request('DELETE', '/api/roles/some-id', { token: memberToken });
  assert.equal(del.status, 403);
  // GET /api/roles is read-only for any authenticated user (used to resolve role names).
  const get = await srv.request('GET', '/api/roles', { token: memberToken });
  assert.equal(get.status, 200);
});

test('SYS-AC-02 / VT-003: PUT /api/settings requires admin → trainer 403, admin 200', async () => {
  const asTrainer = await srv.request('PUT', '/api/settings', {
    token: trainerToken,
    body: { passThreshold: 0.9 },
  });
  assert.equal(asTrainer.status, 403);
  const asAdmin = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { passThreshold: 0.9 },
  });
  assert.equal(asAdmin.status, 200);
  // GET /api/settings is allowed for any authenticated user.
  const get = await srv.request('GET', '/api/settings', { token: memberToken });
  assert.equal(get.status, 200);
});

// ───────────────────────────── SYS-AC-03 / VT-045 / VT-104 : training guards ─────────────────────

test('SYS-AC-03 / VT-003: POST /api/trainings requires trainer-or-admin → member 403', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: memberToken,
    body: { name: 'Unauthorized Training' },
  });
  assert.equal(res.status, 403, 'a plain member cannot create trainings');
});

test('SYS-AC-03: POST /api/trainings is allowed for a trainer (requireTrainerOrAdmin)', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Trainer-created Training' },
  });
  assert.equal(res.status, 201);
});

test('SYS-AC-03 / VT-045: PUT /api/trainings/:id is admin-or-owner — non-owner trainer → 403', async () => {
  // secondTrainerToken is a trainer, but does NOT own ownedTrainingId → requireAdminOrOwner blocks it.
  const res = await srv.request('PUT', `/api/trainings/${ownedTrainingId}`, {
    token: secondTrainerToken,
    body: { name: 'Hijacked name' },
  });
  assert.equal(res.status, 403);
});

test('SYS-AC-03 / VT-045: the owning trainer may PUT their own training', async () => {
  const res = await srv.request('PUT', `/api/trainings/${ownedTrainingId}`, {
    token: trainerToken,
    body: { description: 'Updated by the owner' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.description, 'Updated by the owner');
});

test('SYS-AC-03 / VT-045: DELETE /api/trainings/:id is admin-or-owner — non-owner trainer → 403', async () => {
  const res = await srv.request('DELETE', `/api/trainings/${ownedTrainingId}`, {
    token: secondTrainerToken,
  });
  assert.equal(res.status, 403);
});

test('SYS-AC-03 / VT-104: PUT /api/trainings/reorder requires admin → trainer 403, admin 200', async () => {
  const asTrainer = await srv.request('PUT', '/api/trainings/reorder', {
    token: trainerToken,
    body: { ids: [ownedTrainingId] },
  });
  assert.equal(asTrainer.status, 403);
  const asAdmin = await srv.request('PUT', '/api/trainings/reorder', {
    token: adminToken,
    body: { ids: [ownedTrainingId] },
  });
  assert.equal(asAdmin.status, 200);
});

test('SYS-AC-01 / SYS-AC-03 / VT-003: GET /api/trainings/trainees requires trainer-or-admin → member 403', async () => {
  const asMember = await srv.request('GET', '/api/trainings/trainees', { token: memberToken });
  assert.equal(asMember.status, 403);
  const asTrainer = await srv.request('GET', '/api/trainings/trainees', { token: trainerToken });
  assert.equal(asTrainer.status, 200, 'a trainer sees their own trainees');
});

// ───────────────────────────── VT-007 : SSO graceful-off (password-only) ─────────────────────────

test('VT-007: with SSO disabled (seed default), /sso/config reports enabled:false', async () => {
  const res = await srv.request('GET', '/api/auth/sso/config', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, false, 'app behaves as password-only when SSO is unconfigured');
});

test('VT-007: with SSO disabled, POST /api/auth/sso/entra returns 503', async () => {
  const res = await srv.request('POST', '/api/auth/sso/entra', { body: { idToken: 'anything' } });
  assert.equal(res.status, 503);
});

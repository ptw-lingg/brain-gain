// Automated tests for the admin impersonation requirements:
//   SR-011  Admin can view the app as another user
//   SYS-AC-07 token issuance · SYS-AC-08 guards · SYS-AC-09 client view-as session
//   VT-011 (view-as + return, API-observable parts) · VT-012 (guards)
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app / admin123     (admin)
//   user@braingain.app  / user123      (member, assigned 2 trainings via the Lab Technician role)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, decodeJwt } from './helpers/server.mjs';

let srv;
let adminToken;
let adminId;
let member; // SafeUser

before(async () => {
  srv = await startTestServer();

  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.equal(login.status, 200, 'admin can log in');
  adminToken = login.body.token;
  adminId = login.body.user.id;

  const users = await srv.request('GET', '/api/users', { token: adminToken });
  member = users.body.find((u) => !u.isAdmin && !u.isTrainer);
  assert.ok(member, 'a seeded member exists');
});

after(async () => { await srv?.stop(); });

// ───────────────────────────── VT-011 / SYS-AC-07 ─────────────────────────────

test('SYS-AC-07 / VT-011: impersonating a member yields a target-scoped token carrying the impersonator', async () => {
  const res = await srv.request('POST', `/api/auth/impersonate/${member.id}`, { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, member.id, 'returns the target user');

  const claims = decodeJwt(res.body.token);
  assert.equal(claims.id, member.id, 'token identity is the target');
  assert.equal(claims.isAdmin, false, 'token carries the target\'s (non-admin) flags');
  assert.equal(claims.impersonatorId, adminId, 'token records who is impersonating');
  assert.equal(claims.impersonatorEmail, 'admin@braingain.app');
});

test('VT-011: the whole app renders as the target — /me and /trainings/mine return the member\'s data', async () => {
  const adminMine = await srv.request('GET', '/api/trainings/mine', { token: adminToken });
  assert.equal(adminMine.status, 200);

  const imp = await srv.request('POST', `/api/auth/impersonate/${member.id}`, { token: adminToken });
  const impToken = imp.body.token;

  const me = await srv.request('GET', '/api/auth/me', { token: impToken });
  assert.equal(me.body.id, member.id, '/me is the impersonated member');

  const memberMine = await srv.request('GET', '/api/trainings/mine', { token: impToken });
  assert.equal(memberMine.status, 200);
  // Seeded member has 2 required trainings; the admin (no roles) has 0 — proves the data actually swaps.
  assert.equal(memberMine.body.length, 2, 'member sees their 2 required trainings');
  assert.notEqual(memberMine.body.length, adminMine.body.length, 'differs from the admin\'s own view');
});

// ───────────────────────────── VT-012 / SYS-AC-08 (guards) ─────────────────────────────

test('SYS-AC-08 / VT-012: cannot impersonate yourself → 400', async () => {
  const res = await srv.request('POST', `/api/auth/impersonate/${adminId}`, { token: adminToken });
  assert.equal(res.status, 400);
});

test('VT-012: unknown target → 404', async () => {
  const res = await srv.request('POST', '/api/auth/impersonate/does-not-exist', { token: adminToken });
  assert.equal(res.status, 404);
});

test('VT-012: no token → 401', async () => {
  const res = await srv.request('POST', `/api/auth/impersonate/${member.id}`);
  assert.equal(res.status, 401);
});

test('VT-012: a non-admin (member-scoped) token cannot impersonate → 403', async () => {
  const imp = await srv.request('POST', `/api/auth/impersonate/${member.id}`, { token: adminToken });
  const memberToken = imp.body.token; // isAdmin:false
  const res = await srv.request('POST', `/api/auth/impersonate/${adminId}`, { token: memberToken });
  assert.equal(res.status, 403, 'requireAdmin blocks it');
});

test('VT-012: no nesting — impersonating from an impersonation session → 409', async () => {
  // Need a second admin so the impersonation token stays admin-flagged (so requireAdmin passes and
  // the nesting guard, not requireAdmin, is what rejects). The temp data dir is disposable.
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Second Admin', email: 'admin2@test.local', password: 'pw123456', isAdmin: true },
  });
  assert.equal(created.status, 201);

  const impAdmin = await srv.request('POST', `/api/auth/impersonate/${created.body.id}`, { token: adminToken });
  const impAdminToken = impAdmin.body.token;
  assert.equal(decodeJwt(impAdminToken).isAdmin, true, 'impersonated admin → admin-flagged token');
  assert.ok(decodeJwt(impAdminToken).impersonatorId, 'token still marks it as an impersonation session');

  const nested = await srv.request('POST', `/api/auth/impersonate/${member.id}`, { token: impAdminToken });
  assert.equal(nested.status, 409, 'nesting is refused');
});

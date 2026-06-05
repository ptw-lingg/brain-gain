// Automated API tests for the users-roles requirement area (SYS-USR + SYS-ROL):
//   SYS-USR-01  /api/users admin-only CRUD (create with roleIds/isAdmin/isTrainer;
//               update with blank password keeps the old hash; delete; duplicate email → 409)
//   SYS-ROL-01  /api/roles admin-only CRUD (role.trainingIds round-trips)
//   SYS-AC-02   all mutating /api/users + /api/roles endpoints require admin (non-admin → 403)
//
// Validation tests exercised over the API: VT-020 (admin manages users), VT-021 (several roles
// on a user), VT-030 (admin manages job roles), VT-031 (role requires trainings).
// Stakeholder reqs: SR-020, SR-021, SR-022 (users); SR-030, SR-031 (roles); SR-003 (admin-only).
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app / admin123    (admin)
//   trainer@braingain.app / trainer123 (trainer; owns seeded trainings)
//   user@braingain.app  / user123     (member, holds the "Lab Technician" role → 2 trainings)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let memberToken;
let trainingIds = []; // ids of the two seeded trainings (for role.trainingIds tests)

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.token;
}

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  memberToken = await loginToken('user@braingain.app', 'user123');

  // Grab the seeded training ids so role.trainingIds assertions reference real trainings.
  const trainings = await srv.request('GET', '/api/trainings', { token: adminToken });
  assert.equal(trainings.status, 200);
  trainingIds = trainings.body.map((t) => t.id);
  assert.ok(trainingIds.length >= 2, 'seed provides at least two trainings');
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-USR-01 / VT-020 — users CRUD ─────────────────────────

test('SYS-USR-01 / VT-020 (SR-020, SR-022): admin creates a user with roleIds + isAdmin/isTrainer flags', async () => {
  // Use a real seeded role id so the multi-role assignment is meaningful (VT-021).
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  assert.equal(roles.status, 200);
  const roleId = roles.body[0]?.id;
  assert.ok(roleId, 'a seeded role exists');

  const res = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: {
      name: 'Created User',
      email: 'created.user@test.local',
      password: 'secret123',
      roleIds: [roleId],
      isAdmin: false,
      isTrainer: true,
    },
  });
  assert.equal(res.status, 201, 'user created');
  assert.ok(res.body.id, 'returns the new id');
  assert.equal(res.body.name, 'Created User');
  assert.equal(res.body.email, 'created.user@test.local');
  assert.deepEqual(res.body.roleIds, [roleId], 'roleIds persisted');
  assert.equal(res.body.isAdmin, false, 'isAdmin flag stored');
  assert.equal(res.body.isTrainer, true, 'isTrainer flag stored');
  // SafeUser must never leak the password hash (SR-003 / SR-105).
  assert.equal(res.body.passwordHash, undefined, 'passwordHash is stripped from the response');

  // The created user can actually log in with the supplied password (proves the hash was set).
  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'created.user@test.local', password: 'secret123' },
  });
  assert.equal(login.status, 200, 'created user can log in');
});

test('SYS-USR-01 / VT-020 (SR-020): create rejects missing fields → 400', async () => {
  const res = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'No Email' }, // missing email + password
  });
  assert.equal(res.status, 400);
});

test('SYS-USR-01 / VT-020 (SR-020): duplicate email (case-insensitive) → 409', async () => {
  const base = {
    name: 'Dup One',
    email: 'dup@test.local',
    password: 'secret123',
  };
  const first = await srv.request('POST', '/api/users', { token: adminToken, body: base });
  assert.equal(first.status, 201);

  // Same email, different case — must still be rejected as a duplicate.
  const dup = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { ...base, name: 'Dup Two', email: 'DUP@test.local' },
  });
  assert.equal(dup.status, 409, 'duplicate email rejected');
});

test('SYS-USR-01 / VT-020 (SR-020): update with a blank password keeps the old password', async () => {
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Keep Pw', email: 'keep.pw@test.local', password: 'origpw123' },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  // Update other fields, sending an empty password — the existing hash must be preserved.
  const updated = await srv.request('PUT', `/api/users/${id}`, {
    token: adminToken,
    body: { name: 'Keep Pw Renamed', password: '' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Keep Pw Renamed', 'name updated');

  // Old password still works (blank password did NOT clear it).
  const stillOld = await srv.request('POST', '/api/auth/login', {
    body: { email: 'keep.pw@test.local', password: 'origpw123' },
  });
  assert.equal(stillOld.status, 200, 'old password still valid after blank-password update');
});

test('SYS-USR-01 / VT-020 (SR-022): update changes the password and the admin/trainer flags', async () => {
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Change Pw', email: 'change.pw@test.local', password: 'origpw123' },
  });
  const id = created.body.id;

  const updated = await srv.request('PUT', `/api/users/${id}`, {
    token: adminToken,
    body: { password: 'newpw4567', isAdmin: true, isTrainer: true },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.isAdmin, true, 'isAdmin toggled on');
  assert.equal(updated.body.isTrainer, true, 'isTrainer toggled on');

  // New password works; the old one no longer does.
  const newLogin = await srv.request('POST', '/api/auth/login', {
    body: { email: 'change.pw@test.local', password: 'newpw4567' },
  });
  assert.equal(newLogin.status, 200, 'new password works');
  const oldLogin = await srv.request('POST', '/api/auth/login', {
    body: { email: 'change.pw@test.local', password: 'origpw123' },
  });
  assert.equal(oldLogin.status, 401, 'old password rejected after change');
});

test('SYS-USR-01 / VT-021 (SR-021): a user is assignable to several job roles, and they persist', async () => {
  // Create two roles, then assign both to one user.
  const r1 = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'Multi Role A', description: '', trainingIds: [] },
  });
  const r2 = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'Multi Role B', description: '', trainingIds: [] },
  });
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);

  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: {
      name: 'Multi Role User',
      email: 'multi.role@test.local',
      password: 'secret123',
      roleIds: [r1.body.id, r2.body.id],
    },
  });
  assert.equal(created.status, 201);

  // Re-fetch to confirm persistence (not just echoed back).
  const fetched = await srv.request('GET', `/api/users/${created.body.id}`, { token: adminToken });
  assert.equal(fetched.status, 200);
  assert.deepEqual(
    [...fetched.body.roleIds].sort(),
    [r1.body.id, r2.body.id].sort(),
    'both roleIds persist on the user',
  );
});

test('SYS-USR-01 / VT-020 (SR-020): delete removes the user (then 404)', async () => {
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'To Delete', email: 'to.delete@test.local', password: 'secret123' },
  });
  const id = created.body.id;

  const del = await srv.request('DELETE', `/api/users/${id}`, { token: adminToken });
  assert.equal(del.status, 204, 'delete returns 204');

  const gone = await srv.request('GET', `/api/users/${id}`, { token: adminToken });
  assert.equal(gone.status, 404, 'user no longer exists');

  const delAgain = await srv.request('DELETE', `/api/users/${id}`, { token: adminToken });
  assert.equal(delAgain.status, 404, 'deleting an unknown user → 404');
});

test('GET /api/users never leaks passwordHash (SR-003 / SYS-DATA-07)', async () => {
  const res = await srv.request('GET', '/api/users', { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  for (const u of res.body) {
    assert.equal(u.passwordHash, undefined, 'no passwordHash in list payload');
    assert.equal(u.entraOid, undefined, 'no entraOid in list payload');
  }
});

// ───────────────────────── SYS-AC-02 — users routes are admin-only ─────────────────────────

test('SYS-AC-02 / VT-003 (SR-003): a non-admin (member) is blocked from every /api/users route → 403', async () => {
  const list = await srv.request('GET', '/api/users', { token: memberToken });
  assert.equal(list.status, 403, 'GET /users requires admin');

  const create = await srv.request('POST', '/api/users', {
    token: memberToken,
    body: { name: 'Sneaky', email: 'sneaky@test.local', password: 'secret123' },
  });
  assert.equal(create.status, 403, 'POST /users requires admin');

  const update = await srv.request('PUT', '/api/users/anything', {
    token: memberToken,
    body: { name: 'x' },
  });
  assert.equal(update.status, 403, 'PUT /users/:id requires admin');

  const del = await srv.request('DELETE', '/api/users/anything', { token: memberToken });
  assert.equal(del.status, 403, 'DELETE /users/:id requires admin');
});

test('SYS-AC-02 (SR-003): /api/users requires authentication → 401 without a token', async () => {
  const res = await srv.request('GET', '/api/users');
  assert.equal(res.status, 401);
});

// ───────────────────────── SYS-ROL-01 / VT-030 / VT-031 — roles CRUD ─────────────────────────

test('SYS-ROL-01 / VT-030 (SR-030): admin creates a job role (name, description)', async () => {
  const res = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'QA Inspector', description: 'Quality assurance', trainingIds: [] },
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.id);
  assert.equal(res.body.name, 'QA Inspector');
  assert.equal(res.body.description, 'Quality assurance');
  assert.deepEqual(res.body.trainingIds, []);
});

test('SYS-ROL-01 / VT-030 (SR-030): create rejects a missing name → 400', async () => {
  const res = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { description: 'no name' },
  });
  assert.equal(res.status, 400);
});

test('SYS-ROL-01 / VT-031 (SR-031): role.trainingIds round-trips on create and update', async () => {
  const [t1, t2] = trainingIds;

  // Create with one required training.
  const created = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'Trained Role', description: '', trainingIds: [t1] },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.trainingIds, [t1], 'trainingIds stored on create');
  const id = created.body.id;

  // Update the required trainings to two.
  const updated = await srv.request('PUT', `/api/roles/${id}`, {
    token: adminToken,
    body: { name: 'Trained Role', trainingIds: [t1, t2] },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.trainingIds, [t1, t2], 'trainingIds updated');

  // Re-fetch via the list to confirm persistence.
  const all = await srv.request('GET', '/api/roles', { token: adminToken });
  const reloaded = all.body.find((r) => r.id === id);
  assert.ok(reloaded, 'role still present');
  assert.deepEqual(reloaded.trainingIds, [t1, t2], 'trainingIds persisted across reload');
});

test('SYS-ROL-01 / VT-030 (SR-030): update an unknown role → 404; delete an unknown role → 404', async () => {
  const upd = await srv.request('PUT', '/api/roles/does-not-exist', {
    token: adminToken,
    body: { name: 'x' },
  });
  assert.equal(upd.status, 404);

  const del = await srv.request('DELETE', '/api/roles/does-not-exist', { token: adminToken });
  assert.equal(del.status, 404);
});

test('SYS-ROL-01 / VT-030 (SR-030): admin deletes a role (204, then gone)', async () => {
  const created = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'Temp Role', description: '', trainingIds: [] },
  });
  const id = created.body.id;

  const del = await srv.request('DELETE', `/api/roles/${id}`, { token: adminToken });
  assert.equal(del.status, 204);

  const all = await srv.request('GET', '/api/roles', { token: adminToken });
  assert.equal(all.body.find((r) => r.id === id), undefined, 'role removed');
});

// ───────────────────────── SYS-AC-02 — role mutations are admin-only ─────────────────────────

test('SYS-ROL-01 / SYS-AC-02 (SR-003): a member may READ /api/roles but cannot mutate them', async () => {
  // GET is allowed for any authenticated user (to resolve role names in the UI).
  const list = await srv.request('GET', '/api/roles', { token: memberToken });
  assert.equal(list.status, 200, 'GET /roles is read-only for any authenticated user');

  // Mutations are admin-only → 403.
  const create = await srv.request('POST', '/api/roles', {
    token: memberToken,
    body: { name: 'Member Made', trainingIds: [] },
  });
  assert.equal(create.status, 403, 'POST /roles requires admin');

  const update = await srv.request('PUT', '/api/roles/anything', {
    token: memberToken,
    body: { name: 'x' },
  });
  assert.equal(update.status, 403, 'PUT /roles/:id requires admin');

  const del = await srv.request('DELETE', '/api/roles/anything', { token: memberToken });
  assert.equal(del.status, 403, 'DELETE /roles/:id requires admin');
});

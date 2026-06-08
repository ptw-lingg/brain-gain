// Automated API tests for the clipboard user-import feature:
//   SYS-USR-03   POST /api/users/import — dry-run plan + commit (create disabled member w/ token,
//                full-sync update of existing users, unknown-role/duplicate rows are errors); admin-only.
//   SYS-DATA-09  User.isDisabled + activationToken; activationToken never leaves in a SafeUser.
//   SYS-AUTH-08  a disabled (imported, not-yet-activated) account cannot sign in.
//   SYS-AUTH-09  GET/POST /api/auth/activate — set a password via the one-time token, then sign in.
//
// Validation tests exercised over the API: VT-023 (bulk import), VT-024 (preview), VT-025 (member
// defaults + pending), VT-026 (disabled cannot sign in), VT-027 (activation link sets password).
// Stakeholder reqs: SR-023..SR-027.
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app / admin123    (admin)
//   user@braingain.app  / user123     (member, holds the "Lab Technician" role)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let memberToken;
let labRoleId;

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.token;
}

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  memberToken = await loginToken('user@braingain.app', 'user123');

  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  assert.equal(roles.status, 200);
  labRoleId = roles.body.find((r) => r.name === 'Lab Technician')?.id;
  assert.ok(labRoleId, 'seed provides the "Lab Technician" role');
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-USR-03 / VT-023 — bulk import (create + update) ─────────────────────────

test('SYS-USR-03 / VT-023 (SR-023): import creates new users and updates an existing one (roles matched by name)', async () => {
  // A baseline existing user we will update by email (full self-contained, no seed coupling).
  const baseline = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Existing One', email: 'existing.one@test.local', password: 'secret123', roleIds: [labRoleId] },
  });
  assert.equal(baseline.status, 201);

  const res = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: {
      commit: true,
      rows: [
        { name: 'Nina New', email: 'nina.new@test.local', roles: ['Lab Technician'] },
        // case-insensitive role + email match; full-sync removes the role and renames.
        { name: 'Existing Renamed', email: 'EXISTING.ONE@test.local', roles: [] },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.committed, true);
  assert.deepEqual(res.body.summary, { create: 1, update: 1, unchanged: 0, error: 0 });

  const created = res.body.rows.find((r) => r.email === 'nina.new@test.local');
  assert.equal(created.action, 'create');
  assert.deepEqual(created.matchedRoleIds, [labRoleId], 'role resolved by name');
  assert.ok(typeof created.activationToken === 'string' && created.activationToken.length > 0, 'create returns an activation token');

  const updated = res.body.rows.find((r) => r.email === 'EXISTING.ONE@test.local');
  assert.equal(updated.action, 'update');
  assert.deepEqual(updated.changes.name, { from: 'Existing One', to: 'Existing Renamed' });
  assert.deepEqual(updated.changes.roles, { added: [], removed: ['Lab Technician'] }, 'full-sync removes the dropped role');

  // Persisted as described.
  const all = await srv.request('GET', '/api/users', { token: adminToken });
  const nina = all.body.find((u) => u.email === 'nina.new@test.local');
  assert.ok(nina, 'new user persisted');
  assert.deepEqual(nina.roleIds, [labRoleId]);
  const existing = all.body.find((u) => u.email.toLowerCase() === 'existing.one@test.local');
  assert.equal(existing.name, 'Existing Renamed', 'name updated');
  assert.deepEqual(existing.roleIds, [], 'roles fully replaced');
});

// ───────────────────────── SYS-USR-03 / VT-024 — preview (dry run) ─────────────────────────

test('SYS-USR-03 / VT-024 (SR-024): commit:false previews every row action and writes nothing', async () => {
  const before = await srv.request('GET', '/api/users', { token: adminToken });
  const beforeCount = before.body.length;

  const res = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: {
      commit: false,
      rows: [
        { name: 'Preview New', email: 'preview.new@test.local', roles: ['Lab Technician'] }, // create
        { name: 'Ada Admin', email: 'admin@braingain.app', roles: [] }, // existing admin, no change → unchanged
        { name: 'Bad Role', email: 'bad.role@test.local', roles: ['No Such Role'] }, // error
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.committed, false);
  assert.equal(res.body.summary.create, 1);
  assert.equal(res.body.summary.unchanged, 1, 'admin row with matching name/empty roles is unchanged');
  assert.equal(res.body.summary.error, 1);

  const bad = res.body.rows.find((r) => r.email === 'bad.role@test.local');
  assert.equal(bad.action, 'error');
  assert.deepEqual(bad.unknownRoles, ['No Such Role']);
  assert.ok(bad.errors.some((e) => /Unknown role/i.test(e)));

  // Nothing was written by the dry run.
  const after = await srv.request('GET', '/api/users', { token: adminToken });
  assert.equal(after.body.length, beforeCount, 'no users created by a dry run');
  assert.equal(after.body.find((u) => u.email === 'preview.new@test.local'), undefined);
});

test('SYS-USR-03 / VT-024 (SR-024): invalid email and duplicate-in-paste rows are errors', async () => {
  const res = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: {
      commit: false,
      rows: [
        { name: 'No Email', email: '', roles: [] },
        { name: 'Bad Email', email: 'not-an-email', roles: [] },
        { name: 'First Dup', email: 'dup.row@test.local', roles: [] },
        { name: 'Second Dup', email: 'dup.row@test.local', roles: [] },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.rows[0].action, 'error', 'missing email');
  assert.equal(res.body.rows[1].action, 'error', 'invalid email');
  assert.equal(res.body.rows[2].action, 'create', 'first occurrence is fine');
  assert.equal(res.body.rows[3].action, 'error', 'duplicate email in the paste');
  assert.ok(res.body.rows[3].errors.some((e) => /[Dd]uplicate/.test(e)));
});

// ───────────────────────── SYS-DATA-09 / VT-025 — member defaults + pending state ─────────────────────────

test('SYS-DATA-09 / VT-025 (SR-025): an imported user is a disabled Member with no password + an activation token', async () => {
  const res = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { commit: true, rows: [{ name: 'Mia Member', email: 'mia.member@test.local', roles: ['Lab Technician'] }] },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.rows[0].activationToken, 'a one-time activation token is returned');

  const all = await srv.request('GET', '/api/users', { token: adminToken });
  const mia = all.body.find((u) => u.email === 'mia.member@test.local');
  assert.ok(mia, 'user created');
  assert.equal(mia.isAdmin, false, 'defaults to non-admin');
  assert.equal(mia.isTrainer, false, 'defaults to non-trainer');
  assert.equal(mia.isDisabled, true, 'starts disabled (pending activation)');
});

test('SYS-DATA-09: GET /api/users never leaks activationToken (nor passwordHash/entraOid)', async () => {
  const res = await srv.request('GET', '/api/users', { token: adminToken });
  assert.equal(res.status, 200);
  for (const u of res.body) {
    assert.equal(u.activationToken, undefined, 'no activationToken in list payload');
    assert.equal(u.passwordHash, undefined, 'no passwordHash in list payload');
    assert.equal(u.entraOid, undefined, 'no entraOid in list payload');
  }
});

// ───────────────────────── SYS-AUTH-08 / VT-026 — disabled cannot sign in ─────────────────────────

test('SYS-AUTH-08 / VT-026 (SR-026): a disabled (imported, not-yet-activated) user cannot log in', async () => {
  await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { commit: true, rows: [{ name: 'Dan Disabled', email: 'dan.disabled@test.local', roles: [] }] },
  });

  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'dan.disabled@test.local', password: 'anything-goes' },
  });
  assert.equal(login.status, 401, 'disabled account is refused at login');
});

// ───────────────────────── SYS-AUTH-09 / VT-027 — activation flow ─────────────────────────

test('SYS-AUTH-09 / VT-027 (SR-027): activation sets a password, enables sign-in, and spends the token', async () => {
  const imp = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { commit: true, rows: [{ name: 'Alex Activate', email: 'alex.activate@test.local', roles: ['Lab Technician'] }] },
  });
  const token = imp.body.rows[0].activationToken;
  assert.ok(token, 'got an activation token');

  // The activation page can greet the pending user.
  const peek = await srv.request('GET', `/api/auth/activate/${token}`);
  assert.equal(peek.status, 200);
  assert.equal(peek.body.email, 'alex.activate@test.local');
  assert.equal(peek.body.name, 'Alex Activate');

  // Too-short password is rejected.
  const short = await srv.request('POST', '/api/auth/activate', { body: { token, password: 'short' } });
  assert.equal(short.status, 400, 'password under 8 chars rejected');

  // Setting a valid password activates and signs in.
  const activate = await srv.request('POST', '/api/auth/activate', { body: { token, password: 'brandnew123' } });
  assert.equal(activate.status, 200);
  assert.ok(typeof activate.body.token === 'string', 'returns a session token (auto sign-in)');
  assert.equal(activate.body.user.email, 'alex.activate@test.local');
  assert.equal(activate.body.user.isDisabled, false, 'account is now enabled');

  // The new password now works at the normal login.
  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'alex.activate@test.local', password: 'brandnew123' },
  });
  assert.equal(login.status, 200, 'activated user can log in');

  // The one-time token is spent: peeking and reusing both fail.
  const peekAgain = await srv.request('GET', `/api/auth/activate/${token}`);
  assert.equal(peekAgain.status, 404, 'spent token no longer resolves');
  const reuse = await srv.request('POST', '/api/auth/activate', { body: { token, password: 'another123' } });
  assert.equal(reuse.status, 400, 'reusing a spent token is refused');
});

// ───────────────────────── SYS-AC-02 — import is admin-only ─────────────────────────

test('SYS-AC-02 / SYS-USR-03 (SR-003): import requires admin (member → 403, no token → 401)', async () => {
  const asMember = await srv.request('POST', '/api/users/import', {
    token: memberToken,
    body: { commit: false, rows: [] },
  });
  assert.equal(asMember.status, 403, 'a member cannot import');

  const noToken = await srv.request('POST', '/api/users/import', { body: { commit: false, rows: [] } });
  assert.equal(noToken.status, 401, 'authentication required');
});

// Automated API tests for the self-service password change (1.5.0):
//   SYS-AUTH-11  PUT /api/auth/password { currentPassword, newPassword } — a signed-in user with a local
//                password changes it by proving the current one; no email involved. Validation (400),
//                wrong current password (400 code wrong-password), SSO-only account (409), impersonation
//                (403), unauthenticated (401); audited without the passwords.
// Validation test: VT-230. Stakeholder req: SR-195.
//
// Runs against a freshly-seeded, isolated backend (helpers/server.mjs). Each test uses its own user so
// the seeded credentials other suites rely on are never changed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;

async function login(email, password) {
  return srv.request('POST', '/api/auth/login', { body: { email, password } });
}

/** Create a member with a local password and return { id, token }. */
async function memberWithPassword(email, password) {
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: email.split('@')[0], email, password, roleIds: [] },
  });
  assert.equal(created.status, 201, `create ${email}`);
  const res = await login(email, password);
  assert.equal(res.status, 200, `login ${email}`);
  return { id: created.body.id, token: res.body.token };
}

const changePassword = (token, body) => srv.request('PUT', '/api/auth/password', { token, body });

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).body.token;
});

after(async () => { await srv?.stop(); });

test('SYS-AUTH-11 / VT-230 (SR-195): a signed-in user changes their own password with the current one; the old password stops working', async () => {
  const { id, token } = await memberWithPassword('pat.change@test.local', 'original123');
  const res = await changePassword(token, { currentPassword: 'original123', newPassword: 'changed456' });
  assert.equal(res.status, 204);

  assert.equal((await login('pat.change@test.local', 'changed456')).status, 200, 'the new password signs in');
  assert.equal((await login('pat.change@test.local', 'original123')).status, 401, 'the old password no longer does');

  const raw = readFileSync(join(srv.dataDir, 'audit.ndjson'), 'utf-8');
  const entry = raw.trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.entityId === id && e.details === 'own password changed');
  assert.ok(entry, 'the change is audited');
  assert.equal(entry.actor?.id, id, 'with the user as the actor');
  assert.ok(!raw.includes('changed456') && !raw.includes('original123'), 'no password reaches the log');
});

test('SYS-AUTH-11 / VT-230 (SR-195): a wrong current password, a short or unchanged new password and a missing session are refused and change nothing', async () => {
  const { token } = await memberWithPassword('val.idate@test.local', 'keepthis123');

  const wrong = await changePassword(token, { currentPassword: 'nottheone1', newPassword: 'whatever123' });
  assert.equal(wrong.status, 400, 'wrong current password');
  assert.equal(wrong.body.code, 'wrong-password', 'flagged for the dialog');
  const short = await changePassword(token, { currentPassword: 'keepthis123', newPassword: 'short' });
  assert.equal(short.status, 400, 'new password under 8 characters');
  const same = await changePassword(token, { currentPassword: 'keepthis123', newPassword: 'keepthis123' });
  assert.equal(same.status, 400, 'new password equal to the current one');
  const missing = await changePassword(token, { currentPassword: 'keepthis123' });
  assert.equal(missing.status, 400, 'both fields are required');
  const anon = await srv.request('PUT', '/api/auth/password', { body: { currentPassword: 'keepthis123', newPassword: 'other12345' } });
  assert.equal(anon.status, 401, 'authentication required');

  assert.equal((await login('val.idate@test.local', 'keepthis123')).status, 200, 'the password is unchanged');
});

test('SYS-AUTH-11 / VT-230 (SR-195): an account without a local password (Microsoft sign-in only) gets 409, and an impersonating admin gets 403', async () => {
  // A Microsoft-only account: imported, then enabled by the admin without a password while SSO is configured.
  const imp = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { commit: true, rows: [{ name: 'Sso Only', email: 'sso.only@test.local', roles: [] }] },
  });
  assert.equal(imp.status, 200);
  const list = await srv.request('GET', '/api/users', { token: adminToken });
  const ssoUser = list.body.find((u) => u.email === 'sso.only@test.local');
  await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { entra: { enabled: true, tenantId: '00000000-0000-0000-0000-000000000001', clientId: '00000000-0000-0000-0000-000000000002', allowedDomains: ['test.local'] } },
  });
  try {
    const act = await srv.request('POST', `/api/users/${ssoUser.id}/activate`, { token: adminToken, body: {} });
    assert.equal(act.status, 200, 'enabled without a password');
  } finally {
    await srv.request('PUT', '/api/settings', { token: adminToken, body: { entra: { enabled: false, tenantId: '', clientId: '', allowedDomains: [] } } });
  }
  // Such a user holds a session only via Microsoft sign-in; mint the equivalent app token directly.
  const ssoToken = jwt.sign({ id: ssoUser.id, email: ssoUser.email, isAdmin: false, isTrainer: false }, 'test-secret');
  const noLocal = await changePassword(ssoToken, { currentPassword: 'anything1', newPassword: 'whatever123' });
  assert.equal(noLocal.status, 409, 'nothing to change for a Microsoft-only account');

  const { id: targetId } = await memberWithPassword('imp.target@test.local', 'target1234');
  const imp2 = await srv.request('POST', `/api/auth/impersonate/${targetId}`, { token: adminToken });
  assert.equal(imp2.status, 200);
  const asImpersonator = await changePassword(imp2.body.token, { currentPassword: 'target1234', newPassword: 'hijacked123' });
  assert.equal(asImpersonator.status, 403, 'refused while viewing as another user');
  assert.equal((await login('imp.target@test.local', 'target1234')).status, 200, 'the target password is unchanged');
});

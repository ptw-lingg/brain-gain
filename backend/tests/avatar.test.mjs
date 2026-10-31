// Automated API tests for user profile pictures (1.8.0):
//   SYS-USR-06  PUT /api/auth/me { avatar } — the own picture as a small PNG/JPEG/WebP data URL, null
//               removes it; anything else 400; impersonation 403. Returned in SafeUser and on the
//               trainer contact card.
//   SYS-USR-07  PUT /api/users/:id { avatar } (admin) — same rule; the audit entry masks the image.
// Validation test: VT-237. Stakeholder req: SR-201.
//
// Runs against a freshly-seeded, isolated backend (helpers/server.mjs). Each test uses its own user so
// the seeded accounts other suites rely on are never changed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTestServer } from './helpers/server.mjs';

// A 1×1 transparent PNG — the smallest real image the rule accepts.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let srv;
let adminToken;

async function login(email, password) {
  return srv.request('POST', '/api/auth/login', { body: { email, password } });
}

/** Create a member (trainer when asked) with a local password and return { id, token }. */
async function member(email, { isTrainer = false } = {}) {
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: email.split('@')[0], email, password: 'secret123', roleIds: [], isTrainer },
  });
  assert.equal(created.status, 201, `create ${email}`);
  const res = await login(email, 'secret123');
  assert.equal(res.status, 200, `login ${email}`);
  return { id: created.body.id, token: res.body.token };
}

const setOwn = (token, avatar) => srv.request('PUT', '/api/auth/me', { token, body: { avatar } });
const me = async (token) => (await srv.request('GET', '/api/auth/me', { token })).body;

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).body.token;
});

after(async () => { await srv?.stop(); });

test('SYS-USR-06 / VT-237 (SR-201): a user sets and removes their own picture; it is returned by /auth/me and on the trainer card', async () => {
  const { id, token } = await member('pia.picture@test.local', { isTrainer: true });
  const set = await setOwn(token, PNG);
  assert.equal(set.status, 200);
  assert.equal(set.body.avatar, PNG, 'the response carries the new picture');
  assert.equal((await me(token)).avatar, PNG, 'and /auth/me returns it');

  // A training this user owns: the trainer card a trainee sees carries the owner's picture.
  const created = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: { name: { en: 'Picture course' }, ownerId: id, recurrenceMonths: 12, questions: [] },
  });
  assert.equal(created.status, 201, 'create a training owned by the user');
  const userToken = (await login('user@braingain.app', 'user123')).body.token;
  const card = await srv.request('GET', `/api/trainings/${created.body.id}/trainer`, { token: userToken });
  assert.equal(card.status, 200);
  assert.equal(card.body.avatar, PNG, 'the trainer card shows the picture');

  const removed = await setOwn(token, null);
  assert.equal(removed.status, 200);
  assert.equal((await me(token)).avatar, undefined, 'null removes the picture');
  const cardAfter = await srv.request('GET', `/api/trainings/${created.body.id}/trainer`, { token: userToken });
  assert.equal(cardAfter.body.avatar, null, 'the card falls back to no picture');
});

test('SYS-USR-06 / VT-237 (SR-201): SVG, a plain URL and an oversized image are refused, and an impersonating admin gets 403', async () => {
  const { id, token } = await member('val.idate@test.local');
  assert.equal((await setOwn(token, PNG)).status, 200);

  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  for (const [label, value] of [
    ['SVG', svg],
    ['plain URL', 'https://example.com/me.png'],
    ['oversized', 'data:image/png;base64,' + 'A'.repeat(100_000)],
    ['not a string', 42],
  ]) {
    assert.equal((await setOwn(token, value)).status, 400, `${label} is refused`);
  }
  assert.equal((await me(token)).avatar, PNG, 'the stored picture is unchanged');

  const imp = await srv.request('POST', `/api/auth/impersonate/${id}`, { token: adminToken });
  assert.equal(imp.status, 200);
  assert.equal((await setOwn(imp.body.token, null)).status, 403, 'refused while viewing as another user');
  assert.equal((await me(token)).avatar, PNG, 'the target picture is unchanged');
});

test('SYS-USR-07 / VT-237 (SR-201): an admin sets and removes a user picture; the audit entries mask the image', async () => {
  const { id, token } = await member('adm.set@test.local');

  const bad = await srv.request('PUT', `/api/users/${id}`, { token: adminToken, body: { avatar: 'data:image/gif;base64,R0lGOD' } });
  assert.equal(bad.status, 400, 'a GIF is refused');

  const set = await srv.request('PUT', `/api/users/${id}`, { token: adminToken, body: { avatar: PNG } });
  assert.equal(set.status, 200);
  assert.equal((await me(token)).avatar, PNG, 'the user sees the picture the admin set');

  const kept = await srv.request('PUT', `/api/users/${id}`, { token: adminToken, body: { name: 'Renamed' } });
  assert.equal(kept.body.avatar, PNG, 'an edit without avatar keeps the picture');

  const removed = await srv.request('PUT', `/api/users/${id}`, { token: adminToken, body: { avatar: null } });
  assert.equal(removed.status, 200);
  assert.equal((await me(token)).avatar, undefined, 'null removes it');

  const raw = readFileSync(join(srv.dataDir, 'audit.ndjson'), 'utf-8');
  const entries = raw.trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.entityId === id && e.action === 'update');
  const avatarChanges = entries.flatMap((e) => e.changes ?? []).filter((c) => c.field === 'avatar');
  assert.equal(avatarChanges.length, 2, 'setting and removing are both audited');
  assert.ok(avatarChanges.every((c) => c.from === '***' && c.to === '***'), 'with both values masked');
  assert.ok(!raw.includes(PNG.slice(22)), 'no image data reaches the log');
});

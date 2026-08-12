// Automated API tests for the BrainGain DATA / ARCH / NFR system requirements.
//
// SYS areas covered (data model & persistence, architecture, cross-cutting NFR):
//   SYS-ARCH-05  JSON-file persistence (fs/promises; no DB)        ← SR-101
//   SYS-ARCH-06  First-run seed (admin/trainer/member + data)      ← SR-106
//   SYS-DATA-01  Generic JSON stores round-trip                    ← SR-101 / SR-103
//   SYS-DATA-02  User entity round-trip (roleIds/isAdmin/isTrainer)← SR-021 / SR-022
//   SYS-DATA-03  JobRole entity round-trip                         ← SR-030 / SR-031
//   SYS-DATA-04  Training entity round-trip                        ← SR-040..SR-046
//   SYS-DATA-05  Question answer key stripped for non-owners       ← SR-051
//   SYS-DATA-06  Settings defaults backfilled (threshold + entra)  ← SR-080 / SR-008
//   SYS-DATA-07  SafeUser strips passwordHash + entraOid           ← SR-003 / SR-105
//   SYS-NFR-01   Server-side enforcement (mutations need auth)     ← SR-104
//   SYS-NFR-02   No secret leakage (passwordHash/entraOid/correctIndices) ← SR-105 / SR-051
//
// Validation tests exercised here (API-observable parts):
//   VT-101 (JSON persistence) · VT-103 (entities editable, API layer) ·
//   VT-104 (security enforced server-side) · VT-105 (no secrets leak) · VT-106 (first-run seed)
//
// Runs against a freshly-seeded, isolated backend on a random port (see helpers/server.mjs).
// Seeded fixtures: admin@braingain.app/admin123, trainer@braingain.app/trainer123,
// user@braingain.app/user123 (member, 2 required trainings via the "Lab Technician" role).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let memberToken;
let member; // SafeUser

before(async () => {
  srv = await startTestServer();

  const adminLogin = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.equal(adminLogin.status, 200, 'admin can log in (first-run seed worked)');
  adminToken = adminLogin.body.token;

  const memberLogin = await srv.request('POST', '/api/auth/login', {
    body: { email: 'user@braingain.app', password: 'user123' },
  });
  assert.equal(memberLogin.status, 200, 'seeded member can log in');
  memberToken = memberLogin.body.token;
  member = memberLogin.body.user;
});

after(async () => { await srv?.stop(); });

// ───────────────────── SYS-ARCH-06 / VT-106 — first-run seed ─────────────────────

test('SYS-ARCH-06 / VT-106: first run seeds admin, trainer and member accounts', async () => {
  // All three demo accounts authenticate, proving seed() populated the JSON store on first boot.
  for (const [email, password, flags] of [
    ['admin@braingain.app', 'admin123', { isAdmin: true, isTrainer: false }],
    ['trainer@braingain.app', 'trainer123', { isAdmin: false, isTrainer: true }],
    ['user@braingain.app', 'user123', { isAdmin: false, isTrainer: false }],
  ]) {
    const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
    assert.equal(res.status, 200, `${email} is seeded and can log in`);
    assert.equal(res.body.user.isAdmin, flags.isAdmin, `${email} isAdmin`);
    assert.equal(res.body.user.isTrainer, flags.isTrainer, `${email} isTrainer`);
  }
});

test('SYS-ARCH-06 / VT-106: seed creates the Lab Technician role and its two trainings', async () => {
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  assert.equal(roles.status, 200);
  const lab = roles.body.find((r) => r.name === 'Lab Technician');
  assert.ok(lab, 'seeded "Lab Technician" role exists');
  assert.equal(lab.trainingIds.length, 2, 'role requires the two seeded trainings');

  const trainings = await srv.request('GET', '/api/trainings', { token: adminToken });
  assert.equal(trainings.status, 200);
  const names = trainings.body.map((t) => t.name);
  assert.ok(names.includes('Laboratory Safety Basics'), 'safety training seeded');
  assert.ok(names.includes('Quality Management Intro'), 'quality training seeded');
});

// ───────── SYS-DATA-01/02 + SYS-ARCH-05 / VT-101/VT-103 — user JSON round-trip ─────────

test('SYS-ARCH-05 / SYS-DATA-02 / VT-101/VT-103: a created user round-trips through the JSON store', async () => {
  const create = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: {
      name: 'Persist Pat',
      email: 'persist.pat@test.local',
      password: 'pw123456',
      roleIds: member.roleIds, // reuse the seeded Lab Technician role id(s)
      isAdmin: false,
      isTrainer: true,
    },
  });
  assert.equal(create.status, 201, 'admin creates a user');
  const id = create.body.id;
  assert.ok(id, 'created user has an id (crypto.randomUUID)');

  // Read it back via a SEPARATE request — proves it was persisted to disk, not just echoed.
  const readBack = await srv.request('GET', `/api/users/${id}`, { token: adminToken });
  assert.equal(readBack.status, 200);
  assert.equal(readBack.body.name, 'Persist Pat');
  assert.equal(readBack.body.email, 'persist.pat@test.local');
  assert.equal(readBack.body.isTrainer, true, 'isTrainer flag persisted');
  assert.deepEqual(readBack.body.roleIds, member.roleIds, 'roleIds persisted');

  // And it appears in the full list (the array store).
  const list = await srv.request('GET', '/api/users', { token: adminToken });
  assert.ok(list.body.some((u) => u.id === id), 'user is in the persisted users array');
});

test('SYS-DATA-02: editing a user persists; a blank password keeps the old one', async () => {
  const create = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Edit Eve', email: 'edit.eve@test.local', password: 'origpass1' },
  });
  assert.equal(create.status, 201);
  const id = create.body.id;

  const update = await srv.request('PUT', `/api/users/${id}`, {
    token: adminToken,
    body: { name: 'Edit Eve Renamed', isAdmin: true, password: '' },
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.name, 'Edit Eve Renamed', 'name change persisted');
  assert.equal(update.body.isAdmin, true, 'isAdmin change persisted');

  // Blank password must keep the original — the original password still logs in.
  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'edit.eve@test.local', password: 'origpass1' },
  });
  assert.equal(login.status, 200, 'blank password update kept the existing password');
});

// ───────── SYS-DATA-03 / VT-103 — job role JSON round-trip ─────────

test('SYS-DATA-03 / VT-103: a created job role round-trips through the JSON store', async () => {
  const create = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'Auditor', description: 'Reviews compliance', trainingIds: [] },
  });
  assert.equal(create.status, 201);
  const id = create.body.id;
  assert.ok(id);

  const list = await srv.request('GET', '/api/roles', { token: adminToken });
  const found = list.body.find((r) => r.id === id);
  assert.ok(found, 'role persisted into the roles array');
  assert.equal(found.name, 'Auditor');
  assert.equal(found.description, 'Reviews compliance');
  assert.deepEqual(found.trainingIds, []);
});

// ───────── SYS-DATA-04/05 / VT-103 — training JSON round-trip + answer key handling ─────────

test('SYS-DATA-04 / VT-103: a created training round-trips with its full field set', async () => {
  const create = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: {
      name: 'Data Handling 101',
      description: 'How we store things',
      durationHours: 4,
      category: 'Compliance',
      cycleYears: 2,
      windowBeforeMonths: 1,
      windowAfterMonths: 2,
      materials: [{ variants: [{ locale: 'en', label: 'Doc', url: 'https://example.com/doc' }] }],
      questions: [
        { text: 'Where does data live?', options: ['DB', 'JSON files'], correctIndices: [1] },
      ],
    },
  });
  assert.equal(create.status, 201);
  const id = create.body.id;
  assert.ok(id);
  assert.equal(typeof create.body.order, 'number', 'order assigned (max+1)');

  // Admin owns full record (answer key visible) — read back proves persistence.
  const readBack = await srv.request('GET', `/api/trainings/${id}`, { token: adminToken });
  assert.equal(readBack.status, 200);
  assert.equal(readBack.body.name, 'Data Handling 101');
  assert.equal(readBack.body.durationHours, 4);
  assert.equal(readBack.body.cycleYears, 2);
  assert.equal(readBack.body.windowBeforeMonths, 1);
  assert.equal(readBack.body.windowAfterMonths, 2);
  assert.equal(readBack.body.materials.length, 1, 'materials persisted');
  assert.equal(readBack.body.questions.length, 1, 'questions persisted');
  assert.deepEqual(readBack.body.questions[0].correctIndices, [1], 'admin (owner-level) sees the answer key');
});

test('SYS-DATA-05 / VT-105: correctIndices is stripped from the learner training payload', async () => {
  // The seeded member is required to take 2 trainings; they are NOT the owner, so the public shape
  // (no answer key) is what they receive. SYS-NFR-02: correctIndices must never reach a test-taker.
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.length, 2, 'member has 2 required trainings');
  for (const dt of mine.body) {
    for (const q of dt.training.questions) {
      assert.ok(!('correctIndices' in q), `correctIndices stripped from question "${q.text}"`);
      assert.ok(Array.isArray(q.options) && q.options.length > 0, 'options still present');
    }
  }
});

// ───────── SYS-DATA-06 / VT-103 — settings defaults backfilled & round-trip ─────────

test('SYS-DATA-01 / SYS-DATA-06: GET /settings backfills defaults (passThreshold 0.8, entra defaults, tls null)', async () => {
  const res = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.passThreshold, 0.8, 'default pass threshold backfilled');
  assert.ok(res.body.entra, 'entra block backfilled');
  assert.equal(res.body.entra.enabled, false, 'entra disabled by default (password-only app)');
  assert.equal(res.body.entra.tenantId, '', 'entra tenantId default');
  assert.equal(res.body.entra.clientId, '', 'entra clientId default');
  assert.deepEqual(res.body.entra.allowedDomains, [], 'entra allowedDomains default');
  assert.equal('tls' in res.body, true, 'tls key present');
  assert.equal(res.body.tls, null, 'no TLS metadata until an admin uploads one');
});

test('SYS-DATA-06 / VT-103: settings round-trip — threshold and SSO save independently', async () => {
  // Save only the threshold; entra must be left untouched (partial merge).
  const putThreshold = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { passThreshold: 0.9 },
  });
  assert.equal(putThreshold.status, 200);
  assert.equal(putThreshold.body.passThreshold, 0.9, 'threshold updated');
  assert.equal(putThreshold.body.entra.enabled, false, 'entra unchanged by a threshold save');

  // Save only entra; the threshold must survive.
  const putEntra = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { entra: { enabled: true, tenantId: 't1', clientId: 'c1', allowedDomains: 'A.com, b.com' } },
  });
  assert.equal(putEntra.status, 200);
  assert.equal(putEntra.body.passThreshold, 0.9, 'threshold preserved across an SSO save');
  assert.equal(putEntra.body.entra.enabled, true);
  assert.deepEqual(putEntra.body.entra.allowedDomains, ['a.com', 'b.com'], 'domains sanitized (split/trim/lower)');

  // Re-read proves persistence to the settings file.
  const reread = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(reread.body.passThreshold, 0.9);
  assert.equal(reread.body.entra.tenantId, 't1');
});

// ───────── SYS-DATA-07 / SYS-NFR-02 / VT-105 — no secrets leak ─────────

test('SYS-DATA-07 / SYS-NFR-02 / VT-105: login response carries no passwordHash / entraOid', async () => {
  const res = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.user, 'login returns a SafeUser');
  assert.ok(!('passwordHash' in res.body.user), 'no passwordHash in login user');
  assert.ok(!('entraOid' in res.body.user), 'no entraOid in login user');
});

test('SYS-DATA-07 / SYS-NFR-02 / VT-105: /auth/me carries no secret fields', async () => {
  const res = await srv.request('GET', '/api/auth/me', { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(!('passwordHash' in res.body), 'no passwordHash in /me');
  assert.ok(!('entraOid' in res.body), 'no entraOid in /me');
});

test('SYS-DATA-07 / SYS-NFR-02 / VT-105: no /api/users response leaks passwordHash or entraOid', async () => {
  const list = await srv.request('GET', '/api/users', { token: adminToken });
  assert.equal(list.status, 200);
  for (const u of list.body) {
    assert.ok(!('passwordHash' in u), `no passwordHash for ${u.email}`);
    assert.ok(!('entraOid' in u), `no entraOid for ${u.email}`);
  }
});

// ───────── SYS-NFR-01 / VT-104 — server-side enforcement (mutations rejected w/o auth) ─────────

test('SYS-NFR-01 / VT-104: mutating user/role/settings endpoints reject an unauthenticated request (401)', async () => {
  const cases = [
    ['POST', '/api/users', { name: 'x', email: 'x@x.io', password: 'pw123456' }],
    ['PUT', `/api/users/${member.id}`, { name: 'hacked' }],
    ['DELETE', `/api/users/${member.id}`, undefined],
    ['POST', '/api/roles', { name: 'Sneaky' }],
    ['PUT', '/api/settings', { passThreshold: 0.51 }],
    ['POST', '/api/trainings', { name: 'No auth' }],
  ];
  for (const [method, path, body] of cases) {
    const res = await srv.request(method, path, { body });
    assert.equal(res.status, 401, `${method} ${path} requires authentication`);
  }
});

test('SYS-NFR-01 / VT-104: admin-only mutations reject a non-admin token (403)', async () => {
  const cases = [
    ['POST', '/api/users', { name: 'x', email: 'x2@x.io', password: 'pw123456' }],
    ['POST', '/api/roles', { name: 'Sneaky' }],
    ['PUT', '/api/settings', { passThreshold: 0.55 }],
  ];
  for (const [method, path, body] of cases) {
    const res = await srv.request(method, path, { token: memberToken, body });
    assert.equal(res.status, 403, `${method} ${path} requires admin (member token forbidden)`);
  }
});

test('SYS-NFR-01 / VT-104: a member cannot read the admin-only users list (403)', async () => {
  const res = await srv.request('GET', '/api/users', { token: memberToken });
  assert.equal(res.status, 403, 'GET /api/users is admin-only');
});

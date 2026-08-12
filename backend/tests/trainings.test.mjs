// Automated API tests for the Trainings requirement area (SYS-TRN-*).
//
// Covers the system requirements:
//   SYS-TRN-01  GET /api/trainings — sorted by order; admins see all, trainers ?mine=1; correctIndices
//               stripped for non-owners            (← SR-040, SR-047, SR-051)
//   SYS-TRN-02  GET /api/trainings/:id — answer key stripped for non-owners          (← SR-050)
//   SYS-TRN-03  POST /api/trainings — trainer-or-admin; trainer owns own; admins may target an owner;
//               appends to the end of the order (order = max + 1)   (← SR-045, SR-046)
//   SYS-TRN-04  PUT /api/trainings/:id — admin-or-owner; order preserved; only admin sets ownerId (← SR-045)
//   SYS-TRN-05  DELETE /api/trainings/:id — admin-or-owner only          (← SR-045)
//   SYS-TRN-06  PUT /api/trainings/reorder — admin-only; sets order by array position  (← SR-046)
//   SYS-TRN-07  order is the single source of truth across the list endpoints   (← SR-046, SR-047)
//   SYS-DATA-04 cycleYears (1–5) / windowBefore/AfterMonths (0–3) clamps      (← SR-043, SR-044)
//   SYS-DATA-05 PublicTraining strips correctIndices; sanitizeQuestions/sanitizeLinks (← SR-042, SR-051)
//
// Validation tests exercised here (API-observable parts):
//   VT-040 trainings editable · VT-045 trainer ownership enforced · VT-046 reorder persists
//   VT-047 order respected everywhere · VT-051 server-side grading / answers hidden
//   VT-104 security enforced server-side · VT-105 no secrets (correctIndices) leak to clients
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app   / admin123    (admin)
//   trainer@braingain.app / trainer123  (trainer; owns the two seeded trainings)
//   user@braingain.app    / user123     (member; holds "Lab Technician" → 2 trainings)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;
let trainerId;
let adminId;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

before(async () => {
  srv = await startTestServer();

  const admin = await login('admin@braingain.app', 'admin123');
  adminToken = admin.token;
  adminId = admin.user.id;

  const trainer = await login('trainer@braingain.app', 'trainer123');
  trainerToken = trainer.token;
  trainerId = trainer.user.id;

  const member = await login('user@braingain.app', 'user123');
  memberToken = member.token;
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-TRN-01 / SYS-TRN-07 — GET / ordered ─────────────────────────

test('SYS-TRN-01 / VT-047: GET /api/trainings returns trainings sorted by order ascending', async () => {
  const res = await srv.request('GET', '/api/trainings', { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length >= 2, 'two seeded trainings are present');
  const orders = res.body.map((t) => t.order);
  const sorted = [...orders].sort((a, b) => a - b);
  assert.deepEqual(orders, sorted, 'order is ascending');
});

test('SYS-TRN-01 / VT-051 / VT-105: a non-owner (member) receives the PUBLIC shape — correctIndices stripped', async () => {
  const res = await srv.request('GET', '/api/trainings', { token: memberToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 1);
  for (const t of res.body) {
    for (const q of t.questions) {
      assert.ok(Array.isArray(q.options) && q.options.length > 0, 'options still present');
      assert.equal(
        Object.prototype.hasOwnProperty.call(q, 'correctIndices'),
        false,
        'correctIndices must never be sent to a non-owner',
      );
    }
  }
});

test('SYS-TRN-01 / VT-051: the owning trainer DOES receive correctIndices (full shape)', async () => {
  const res = await srv.request('GET', '/api/trainings', { token: trainerToken });
  assert.equal(res.status, 200);
  // The trainer owns both seeded trainings → every question keeps its answer key.
  for (const t of res.body) {
    for (const q of t.questions) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(q, 'correctIndices'),
        true,
        'owner sees correctIndices',
      );
    }
  }
});

test('SYS-TRN-01 / VT-045: ?mine=1 returns only the trainer\'s own trainings', async () => {
  const all = await srv.request('GET', '/api/trainings', { token: adminToken });
  const mine = await srv.request('GET', '/api/trainings?mine=1', { token: trainerToken });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.length >= 1);
  for (const t of mine.body) {
    assert.equal(t.ownerId, trainerId, 'every returned training is owned by the trainer');
  }
  // Sanity: the admin (no mine filter) sees at least as many.
  assert.ok(all.body.length >= mine.body.length);
});

test('SYS-TRN-01 / VT-104: GET /api/trainings requires authentication → 401', async () => {
  const res = await srv.request('GET', '/api/trainings');
  assert.equal(res.status, 401);
});

// ───────────────────────── SYS-TRN-02 — GET /:id ─────────────────────────

test('SYS-TRN-02 / VT-051: GET /:id strips correctIndices for a non-owner but keeps it for the owner', async () => {
  const list = await srv.request('GET', '/api/trainings', { token: adminToken });
  const id = list.body[0].id;

  const asMember = await srv.request('GET', `/api/trainings/${id}`, { token: memberToken });
  assert.equal(asMember.status, 200);
  for (const q of asMember.body.questions) {
    assert.equal(Object.prototype.hasOwnProperty.call(q, 'correctIndices'), false);
  }

  const asTrainer = await srv.request('GET', `/api/trainings/${id}`, { token: trainerToken });
  assert.equal(asTrainer.status, 200);
  for (const q of asTrainer.body.questions) {
    assert.equal(Object.prototype.hasOwnProperty.call(q, 'correctIndices'), true);
  }
});

test('SYS-TRN-02: GET /:id for an unknown training → 404', async () => {
  const res = await srv.request('GET', '/api/trainings/does-not-exist', { token: adminToken });
  assert.equal(res.status, 404);
});

// ───────────────────────── SYS-TRN-03 — POST / (create) ─────────────────────────

test('SYS-TRN-03 / VT-104: a plain member cannot create a training → 403', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: memberToken,
    body: { name: 'Member Attempt' },
  });
  assert.equal(res.status, 403);
});

test('SYS-TRN-03 / VT-040: a trainer can create a training; it is owned by them and appended to the end of the order', async () => {
  const before = await srv.request('GET', '/api/trainings', { token: adminToken });
  const maxOrder = Math.max(...before.body.map((t) => t.order));

  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Trainer Created', description: 'd', category: 'C', durationHours: 2 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.ownerId, trainerId, 'trainer owns what they create');
  assert.equal(res.body.order, maxOrder + 1, 'new training appended at max order + 1');
  assert.ok(res.body.id, 'a UUID id was assigned');
});

test('SYS-TRN-03 / VT-045: a trainer cannot set ownerId on create — they always own it', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Try To Reassign', ownerId: adminId },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.ownerId, trainerId, 'ownerId is forced to the creating trainer, ignoring the body');
});

test('SYS-TRN-03 / VT-045: only an admin may target another owner on create', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: { name: 'Admin Assigns Owner', ownerId: trainerId },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.ownerId, trainerId, 'admin may assign the owner');
});

test('SYS-TRN-03: POST without a name → 400', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { description: 'no name' },
  });
  assert.equal(res.status, 400);
});

// ───────────────────────── SYS-DATA-04 / SYS-DATA-05 — clamps & sanitize on create ─────────────────────────

test('SYS-DATA-04: cycleYears clamps to 1–5 and window months clamp to 0–3', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Clamp Me',
      cycleYears: 99,
      windowBeforeMonths: -5,
      windowAfterMonths: 17,
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.cycleYears, 5, 'cycleYears clamped to max 5');
  assert.equal(res.body.windowBeforeMonths, 0, 'windowBeforeMonths clamped to min 0');
  assert.equal(res.body.windowAfterMonths, 3, 'windowAfterMonths clamped to max 3');
});

test('SYS-DATA-04: a non-numeric cycleYears falls back to the default (1)', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Bad Cycle', cycleYears: 'lots' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.cycleYears, 1, 'invalid cycleYears → fallback 1');
});

test('SYS-DATA-11: link variants are sanitized — junk coerced, empty and unknown-locale variants dropped', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Links',
      materials: [
        { variants: [{ locale: 'en', label: 'Good', url: 'https://example.com/doc', junk: 'dropped' }] },
        { variants: [{ locale: 'en', label: 42, url: null }] }, // no usable content → variant dropped → material dropped
        { variants: [{ locale: 'xx', label: 'Nope', url: 'https://example.com/xx' }] }, // unknown locale → dropped
        'not-an-object',
      ],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.materials.length, 1, 'only the well-formed material survives');
  const material = res.body.materials[0];
  assert.ok(material.id, 'the material got a server-assigned id');
  assert.deepEqual(material.variants, [{ locale: 'en', label: 'Good', url: 'https://example.com/doc' }],
    'extra keys dropped; content-less and unknown-locale variants are gone');
});

test('SYS-DATA-05 / SYS-TRN-12: questions are sanitized — id assigned, legacy strings localized, answer key normalized', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Questions',
      questions: [
        { text: 'Q1', options: ['a', 'b', 'c'], correctIndices: [2] },
        { text: 'Q2', options: ['x', 'y'], correctIndices: 'nope' }, // unusable → falls back to [0]
        // A bare number (a legacy client) still normalizes to a one-element key.
        { text: 'Q3', options: ['p', 'q'], correctIndex: 1 },
        // Out-of-range, duplicate and unordered entries are cleaned up.
        { text: 'Q4', options: ['a', 'b', 'c'], correctIndices: [2, 0, 2, 9, -1, 'x'] },
      ],
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.questions.length, 4);
  assert.ok(res.body.questions[0].id, 'a question id was generated');
  assert.deepEqual(res.body.questions[0].correctIndices, [2]);
  assert.deepEqual(res.body.questions[0].text, { en: 'Q1' }, 'a legacy plain-string text becomes the English entry');
  assert.deepEqual(res.body.questions[0].options, [{ en: 'a' }, { en: 'b' }, { en: 'c' }], 'legacy string options localize too');
  assert.deepEqual(res.body.questions[1].correctIndices, [0], 'an unusable answer key falls back to [0]');
  assert.deepEqual(res.body.questions[2].correctIndices, [1], 'a legacy scalar correctIndex is accepted');
  assert.deepEqual(res.body.questions[3].correctIndices, [0, 2], 'deduped, in-bounds and ascending');
  assert.equal(res.body.questions[3].correctIndex, undefined, 'the legacy field is never stored');
});

test('SYS-TRN-12 / SR-146 / VT-146: a question may carry several correct answers, stored as given', async () => {
  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Multi-answer',
      questions: [
        { text: 'Which are examples of design output?', options: ['libraries', 'drawings', 'boards', 'a wish'], correctIndices: [0, 1, 2] },
      ],
    },
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.questions[0].correctIndices, [0, 1, 2], 'all three correct answers persist');

  const readBack = await srv.request('GET', `/api/trainings/${res.body.id}`, { token: trainerToken });
  assert.deepEqual(readBack.body.questions[0].correctIndices, [0, 1, 2], 'and survive a round-trip');
});

// ───────────────────────── SYS-TRN-04 — PUT /:id (update) ─────────────────────────

test('SYS-TRN-04 / VT-040: an admin can edit any training; order is preserved', async () => {
  const list = await srv.request('GET', '/api/trainings', { token: adminToken });
  const target = list.body[0];
  const originalOrder = target.order;

  const res = await srv.request('PUT', `/api/trainings/${target.id}`, {
    token: adminToken,
    body: { name: 'Renamed By Admin', category: 'Updated' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Renamed By Admin');
  assert.equal(res.body.category, 'Updated');
  assert.equal(res.body.order, originalOrder, 'order is not changed by PUT /:id');
});

test('SYS-TRN-04 / VT-045 / VT-104: a trainer can edit their OWN training', async () => {
  const mine = await srv.request('GET', '/api/trainings?mine=1', { token: trainerToken });
  const owned = mine.body[0];
  const res = await srv.request('PUT', `/api/trainings/${owned.id}`, {
    token: trainerToken,
    body: { description: 'edited by owner' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.description, 'edited by owner');
});

test('SYS-TRN-04 / VT-045 / VT-104: a trainer CANNOT edit a training owned by someone else → 403', async () => {
  // Create a training owned by the admin, then try to edit it as the trainer.
  const created = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: { name: 'Admin Owned', ownerId: adminId },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.ownerId, adminId);

  const res = await srv.request('PUT', `/api/trainings/${created.body.id}`, {
    token: trainerToken,
    body: { name: 'Hijack' },
  });
  assert.equal(res.status, 403, 'requireAdminOrOwner blocks a non-owner trainer');
});

test('SYS-TRN-04 / VT-045: only an admin may change ownerId; a trainer\'s ownerId in the body is ignored', async () => {
  const mine = await srv.request('GET', '/api/trainings?mine=1', { token: trainerToken });
  const owned = mine.body.find((t) => t.ownerId === trainerId);

  // Trainer tries to reassign their own training to the admin — must be ignored.
  const asTrainer = await srv.request('PUT', `/api/trainings/${owned.id}`, {
    token: trainerToken,
    body: { name: owned.name, ownerId: adminId },
  });
  assert.equal(asTrainer.status, 200);
  assert.equal(asTrainer.body.ownerId, trainerId, 'a trainer cannot reassign ownership');

  // Admin reassigns the same training to the admin — allowed.
  const asAdmin = await srv.request('PUT', `/api/trainings/${owned.id}`, {
    token: adminToken,
    body: { ownerId: adminId },
  });
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.body.ownerId, adminId, 'an admin may reassign ownership');

  // Restore ownership so later tests still find trainer-owned trainings.
  await srv.request('PUT', `/api/trainings/${owned.id}`, {
    token: adminToken,
    body: { ownerId: trainerId },
  });
});

test('SYS-DATA-04: PUT clamps cycle/window and keeps current values when fields are omitted', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Update Clamp', cycleYears: 3, windowBeforeMonths: 1, windowAfterMonths: 1 },
  });
  const id = created.body.id;

  // Out-of-range update → clamped.
  const clamped = await srv.request('PUT', `/api/trainings/${id}`, {
    token: trainerToken,
    body: { cycleYears: 0, windowAfterMonths: 9 },
  });
  assert.equal(clamped.body.cycleYears, 1, 'cycleYears clamped to min 1');
  assert.equal(clamped.body.windowAfterMonths, 3, 'windowAfterMonths clamped to max 3');
  assert.equal(clamped.body.windowBeforeMonths, 1, 'omitted windowBeforeMonths kept at current value');

  // Omitting cycleYears keeps the current (clamped) value.
  const kept = await srv.request('PUT', `/api/trainings/${id}`, {
    token: trainerToken,
    body: { name: 'Still Update Clamp' },
  });
  assert.equal(kept.body.cycleYears, 1, 'cycleYears preserved when not supplied');
});

test('SYS-TRN-04: PUT on an unknown training → 404 for an admin', async () => {
  const res = await srv.request('PUT', '/api/trainings/nope-not-real', {
    token: adminToken,
    body: { name: 'x' },
  });
  assert.equal(res.status, 404);
});

// ───────────────────────── SYS-TRN-06 — PUT /reorder ─────────────────────────

test('SYS-TRN-06 / VT-046: a trainer cannot reorder → 403 (admin-only)', async () => {
  const list = await srv.request('GET', '/api/trainings', { token: adminToken });
  const ids = list.body.map((t) => t.id);
  const res = await srv.request('PUT', '/api/trainings/reorder', {
    token: trainerToken,
    body: { ids },
  });
  assert.equal(res.status, 403);
});

test('SYS-TRN-06 / VT-046 / VT-047: an admin can reorder; order persists and equals array position', async () => {
  const list = await srv.request('GET', '/api/trainings', { token: adminToken });
  const ids = list.body.map((t) => t.id);
  assert.ok(ids.length >= 2);

  // Reverse the order.
  const reversed = [...ids].reverse();
  const res = await srv.request('PUT', '/api/trainings/reorder', {
    token: adminToken,
    body: { ids: reversed },
  });
  assert.equal(res.status, 200);
  // Response is sorted by the new order: it must match the reversed id sequence.
  assert.deepEqual(res.body.map((t) => t.id), reversed, 'reorder applies the requested sequence');
  res.body.forEach((t, i) => assert.equal(t.order, i, 'order equals array position'));

  // Re-fetch to prove persistence (the route is registered before /:id, so "reorder" is not an id).
  const after = await srv.request('GET', '/api/trainings', { token: adminToken });
  assert.deepEqual(after.body.map((t) => t.id), reversed, 'new order survives a re-read');

  // Restore the original order for any later assertions.
  await srv.request('PUT', '/api/trainings/reorder', { token: adminToken, body: { ids } });
});

test('SYS-TRN-06: reorder without an ids array → 400', async () => {
  const res = await srv.request('PUT', '/api/trainings/reorder', {
    token: adminToken,
    body: { ids: 'not-an-array' },
  });
  assert.equal(res.status, 400);
});

test('SYS-TRN-07 / VT-047: order set via reorder is respected on /trainings/mine for the member', async () => {
  // The member holds the "Lab Technician" role → exactly two required trainings. Identify them
  // via /mine (independent of any renames other tests may have applied).
  const minePre = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.equal(minePre.status, 200);
  assert.equal(minePre.body.length, 2, 'member has exactly two required trainings');
  const [a, b] = minePre.body.map((d) => d.training.id);

  const all = await srv.request('GET', '/api/trainings', { token: adminToken });
  const others = all.body.filter((t) => t.id !== a && t.id !== b).map((t) => t.id);

  // Force the two required trainings into a known order: b before a.
  await srv.request('PUT', '/api/trainings/reorder', {
    token: adminToken,
    body: { ids: [b, a, ...others] },
  });
  let mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.deepEqual(mine.body.map((d) => d.training.id), [b, a], 'dashboard reflects b-before-a');

  // Flip it: a before b — the dashboard order must follow.
  await srv.request('PUT', '/api/trainings/reorder', {
    token: adminToken,
    body: { ids: [a, b, ...others] },
  });
  mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.deepEqual(mine.body.map((d) => d.training.id), [a, b], 'dashboard follows the admin-defined order');
});

// ───────────────────────── SYS-TRN-05 — DELETE /:id ─────────────────────────

test('SYS-TRN-05 / VT-104: a plain member cannot delete a training → 403', async () => {
  const list = await srv.request('GET', '/api/trainings', { token: adminToken });
  const res = await srv.request('DELETE', `/api/trainings/${list.body[0].id}`, { token: memberToken });
  assert.equal(res.status, 403);
});

test('SYS-TRN-05 / VT-045: a trainer cannot delete a training they do not own → 403', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: { name: 'Admin Owned For Delete', ownerId: adminId },
  });
  const res = await srv.request('DELETE', `/api/trainings/${created.body.id}`, { token: trainerToken });
  assert.equal(res.status, 403);
});

test('SYS-TRN-05 / VT-045: a trainer can delete their own training → 204, and it is gone', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Trainer Owned For Delete' },
  });
  const id = created.body.id;
  const del = await srv.request('DELETE', `/api/trainings/${id}`, { token: trainerToken });
  assert.equal(del.status, 204);

  const after = await srv.request('GET', `/api/trainings/${id}`, { token: adminToken });
  assert.equal(after.status, 404, 'deleted training is no longer found');
});

test('SYS-TRN-05: an admin can delete any training; deleting an unknown id → 404', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'For Admin Delete' },
  });
  const del = await srv.request('DELETE', `/api/trainings/${created.body.id}`, { token: adminToken });
  assert.equal(del.status, 204, 'admin deletes a trainer-owned training');

  const missing = await srv.request('DELETE', '/api/trainings/never-existed', { token: adminToken });
  assert.equal(missing.status, 404);
});

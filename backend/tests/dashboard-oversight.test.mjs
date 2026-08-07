// Automated tests for the Dashboard & Trainee Oversight system requirements:
//   SYS-DSH-01  Dashboard cards  (derivedFrom SR-060 "dashboard of required trainings + status", SR-061 empty state)
//   SYS-OVS-01  GET /trainees grouped (derivedFrom SR-070 "who must take each training", SR-047 ordering)
//   Validation tests: VT-060 (dashboard shows required trainings + status), VT-061 (friendly empty state),
//                      VT-070 (trainee oversight grouped by training).
//
// Covers the API-observable parts of these requirements:
//   GET /api/trainings/mine     — the signed-in member's required (deduped, ordered) trainings + due status.
//   GET /api/trainings/trainees — who must take each training, grouped (trainer: owned; admin: all).
// The implementing source is backend/src/routes/trainings.ts (/mine, /trainees) + services/due.ts (computeDue).
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app / admin123       (admin, holds NO job roles → 0 required trainings)
//   trainer@braingain.app / trainer123   (trainer, owns BOTH seeded trainings)
//   user@braingain.app / user123         (member, "Lab Technician" role → 2 required trainings)
// Seeded trainings (ordered): "Laboratory Safety Basics" (order 0, 3 questions),
//                             "Quality Management Intro" (order 1, 2 questions). No sessions seeded → status 'never'.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;
let trainerId;

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `${email} can log in`);
  return res;
}

before(async () => {
  srv = await startTestServer();

  const admin = await loginToken('admin@braingain.app', 'admin123');
  adminToken = admin.body.token;

  const trainer = await loginToken('trainer@braingain.app', 'trainer123');
  trainerToken = trainer.body.token;
  trainerId = trainer.body.user.id;

  const member = await loginToken('user@braingain.app', 'user123');
  memberToken = member.body.token;
});

after(async () => { await srv?.stop(); });

// ─────────────────────────── SYS-DSH-01 / VT-060 — GET /trainings/mine ───────────────────────────

test('SYS-DSH-01 / VT-060: a member sees exactly their 2 required trainings, in admin-defined order', async () => {
  const res = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 2, 'Lab Technician role requires 2 trainings');

  const names = res.body.map((d) => d.training.name);
  // readOrderedTrainings sorts by `order`: safety (0) before quality (1) — SR-047.
  assert.deepEqual(names, ['Laboratory Safety Basics', 'Quality Management Intro'], 'ordered by training.order');
});

test('SYS-DSH-01 / VT-060: each item carries a computed due status + the card fields the dashboard renders', async () => {
  const res = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  for (const item of res.body) {
    // No passing sessions are seeded, so every required training is "never" taken (rendered "Due now").
    assert.equal(item.status, 'never', 'never-taken trainings report status "never"');
    assert.equal(item.dueDate, null, 'no due date until first pass');
    assert.equal(item.lastPassedAt, null, 'no last-passed timestamp until first pass');
    // Fields the DashboardPage / TrainingCard read off training.*
    const t = item.training;
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.description, 'string');
    assert.equal(typeof t.durationHours, 'number');
    assert.equal(typeof t.category, 'string');
    assert.equal(typeof t.cycleYears, 'number');
  }
});

test('SYS-DSH-01 / VT-060: the answer key (correctIndices) is never sent on /mine (PublicTraining shape)', async () => {
  const res = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  for (const item of res.body) {
    assert.ok(item.training.questions.length > 0, 'training carries its quiz questions');
    for (const q of item.training.questions) {
      assert.equal('correctIndices' in q, false, 'correctIndices stripped for the learner');
      assert.ok(Array.isArray(q.options), 'options still present');
    }
  }
});

test('SYS-DSH-01 / VT-061: an admin with no job roles gets an empty /mine (drives the friendly empty state)', async () => {
  const res = await srv.request('GET', '/api/trainings/mine', { token: adminToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [], 'no roles → no required trainings → empty array (not an error)');
});

test('SYS-DSH-01 / VT-060: required trainings are deduped — overlapping roles do not double-list', async () => {
  // Give the trainer a second role that ALSO requires the same two trainings; the member already
  // holds Lab Technician. Add the second role to the member too → still exactly 2 (deduped union, SR-032).
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  assert.equal(roles.status, 200);
  const labRole = roles.body.find((r) => r.name === 'Lab Technician');
  assert.ok(labRole, 'seeded Lab Technician role exists');

  const dupRole = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'Senior Technician', description: 'overlaps', trainingIds: labRole.trainingIds },
  });
  assert.equal(dupRole.status, 201);

  const users = await srv.request('GET', '/api/users', { token: adminToken });
  const member = users.body.find((u) => u.email === 'user@braingain.app');
  const upd = await srv.request('PUT', `/api/users/${member.id}`, {
    token: adminToken,
    body: { roleIds: [labRole.id, dupRole.body.id] },
  });
  assert.equal(upd.status, 200);

  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.equal(mine.body.length, 2, 'union of two overlapping roles is still 2 distinct trainings');
});

test('SYS-DSH-01: /mine requires authentication → 401 without a token', async () => {
  const res = await srv.request('GET', '/api/trainings/mine');
  assert.equal(res.status, 401);
});

// ─────────────────────────── SYS-OVS-01 / VT-070 — GET /trainings/trainees ───────────────────────────

test('SYS-OVS-01 / VT-070: an admin sees ALL trainings grouped, each with its trainees + due status', async () => {
  const res = await srv.request('GET', '/api/trainings/trainees', { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 2, 'admin sees both seeded trainings as groups');

  // Groups are ordered by training.order (SR-047).
  assert.deepEqual(
    res.body.map((g) => g.training.name),
    ['Laboratory Safety Basics', 'Quality Management Intro'],
  );

  for (const group of res.body) {
    // The seeded member holds Lab Technician, which demands both trainings → present in each group.
    const trainee = group.trainees.find((t) => t.user.email === 'user@braingain.app');
    assert.ok(trainee, `member is listed under "${group.training.name}"`);
    assert.equal(trainee.status, 'never', 'never-taken → "never" status');
    assert.ok('dueDate' in trainee, 'each trainee carries a dueDate field');
  }
});

test('SYS-OVS-01 / VT-070: a trainer sees only trainings they OWN (here: both, owned by the trainer)', async () => {
  const res = await srv.request('GET', '/api/trainings/trainees', { token: trainerToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2, 'the seeded trainer owns both trainings');
  for (const g of res.body) {
    assert.equal(g.training.ownerId, trainerId, 'every group is a training this trainer owns');
  }
});

test('SYS-OVS-01: a trainer who owns nothing sees an empty grouping (not others’ trainings)', async () => {
  // Create a fresh trainer that owns no trainings → /trainees returns [] (admin-only see all).
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'New Trainer', email: 'trainer2@test.local', password: 'pw123456', isTrainer: true },
  });
  assert.equal(created.status, 201);
  const login = await loginToken('trainer2@test.local', 'pw123456');

  const res = await srv.request('GET', '/api/trainings/trainees', { token: login.body.token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [], 'a trainer who owns no trainings sees no groups');
});

test('SYS-OVS-01: trainee user objects are SafeUsers — no passwordHash / entraOid leak (SR-105/SR-003)', async () => {
  const res = await srv.request('GET', '/api/trainings/trainees', { token: adminToken });
  for (const g of res.body) {
    for (const t of g.trainees) {
      assert.equal('passwordHash' in t.user, false, 'passwordHash never leaves the server');
      assert.equal('entraOid' in t.user, false, 'entraOid never leaves the server');
      assert.equal(typeof t.user.email, 'string', 'email IS present (needed for copy-emails)');
    }
  }
});

test('SYS-OVS-01 / VT-070: a plain member cannot access /trainees → 403 (requireTrainerOrAdmin)', async () => {
  const res = await srv.request('GET', '/api/trainings/trainees', { token: memberToken });
  assert.equal(res.status, 403);
});

test('SYS-OVS-01: /trainees requires authentication → 401 without a token', async () => {
  const res = await srv.request('GET', '/api/trainings/trainees');
  assert.equal(res.status, 401);
});

// ─────────────────── SYS-OVS-01 / VT-070 — due status reflects a recorded pass ───────────────────

test('SYS-OVS-01 / VT-070: after a member passes a quiz, oversight flips that trainee to "up-to-date"', async () => {
  // Pass the safety quiz as the member (3 questions, correct indices 1,1,2; threshold 0.8 → 100% passes).
  const trainings = await srv.request('GET', '/api/trainings', { token: trainerToken });
  const safety = trainings.body.find((t) => t.name === 'Laboratory Safety Basics');
  assert.ok(safety, 'trainer can read the owned training with the answer key');
  // The key is a set of indices per question (a question may have several correct answers).
  const correctAnswers = safety.questions.map((q) => q.correctIndices);

  const grade = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: safety.id, answers: correctAnswers },
  });
  assert.equal(grade.status, 200);
  assert.equal(grade.body.passed, true, 'all-correct answers pass the 0.8 threshold');

  // Member's own dashboard now reports the safety training as up-to-date with a due date.
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  const mineSafety = mine.body.find((d) => d.training.id === safety.id);
  assert.equal(mineSafety.status, 'up-to-date', 'a fresh pass is up-to-date');
  assert.ok(mineSafety.dueDate, 'a due date is computed from the pass + cycle');

  // Trainer oversight reflects the same computed status for that trainee.
  const trainees = await srv.request('GET', '/api/trainings/trainees', { token: trainerToken });
  const safetyGroup = trainees.body.find((g) => g.training.id === safety.id);
  const memberRow = safetyGroup.trainees.find((t) => t.user.email === 'user@braingain.app');
  assert.equal(memberRow.status, 'up-to-date', 'oversight shows the same server-computed status');
  assert.ok(memberRow.dueDate, 'oversight carries the computed due date');
});

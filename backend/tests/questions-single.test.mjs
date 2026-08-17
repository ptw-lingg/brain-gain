// Automated tests for single-choice quiz questions (SYS-TRN-14, SYS-SES-06).
//
// Covers the system requirements / validation tests:
//   SYS-TRN-14 / SR-149 / VT-151  a question carries a type ('single' | 'multiple'); 'single' requires
//                                 exactly one correct answer and is coerced to 'multiple' otherwise;
//                                 records without a type keep behaving as multiple-choice
//   SYS-SES-06 / SR-150 / VT-151  the learner payload names the type (radio vs checkbox rendering)
//                                 while still hiding the answer key; grading stays exact set match
//
// A trainer-owned training is created per scenario so the seeded fixtures stay untouched.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';

let srv;
let trainerToken;
let memberToken;
let adminToken;
let labRoleId;

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `${email} can log in`);
  return res.body.token;
}

/** Create a trainer-owned training the seeded member is required to take (published as v1). */
async function createRequiredTraining(name, questions) {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name, category: 'Test', durationMinutes: 60, questions },
  });
  assert.equal(created.status, 201, 'training created');
  // Content lands in the draft — publish it so the member actually sees and can take it.
  await publishSilent(srv, created.body.id, trainerToken);

  // Assign it to the member's job role so they may take it.
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  const lab = roles.body.find((r) => r.id === labRoleId);
  const upd = await srv.request('PUT', `/api/roles/${labRoleId}`, {
    token: adminToken,
    body: { name: lab.name, trainingIds: [...lab.trainingIds, created.body.id] },
  });
  assert.equal(upd.status, 200, 'training assigned to the Lab Technician role');
  return created.body;
}

const grade = (trainingId, answers) =>
  srv.request('POST', '/api/sessions/grade', { token: memberToken, body: { trainingId, answers } });

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  trainerToken = await loginToken('trainer@braingain.app', 'trainer123');
  memberToken = await loginToken('user@braingain.app', 'user123');
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  labRoleId = roles.body.find((r) => r.name === 'Lab Technician').id;
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-TRN-14 — the question type persists ─────────────────────────

test('SYS-TRN-14 / SR-149 / VT-151: a question round-trips its type, and one saved without a type is multiple-choice', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Type round-trip',
      questions: [
        { text: 'Single', options: ['a', 'b'], correctIndices: [1], type: 'single' },
        { text: 'Untyped', options: ['a', 'b'], correctIndices: [0] },
      ],
    },
  });
  assert.equal(created.status, 201);
  const staged = created.body.draft.questions; // content is staged until published
  assert.equal(staged[0].type, 'single', 'single survives the write path');
  assert.equal(staged[1].type, 'multiple', 'no type defaults to multiple and is persisted explicitly');

  // The type survives an update untouched.
  const updated = await srv.request('PUT', `/api/trainings/${created.body.id}`, {
    token: trainerToken,
    body: { ...created.body, materials: created.body.draft.materials, questions: staged },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.draft.questions[0].type, 'single', 'PUT keeps the type');

  const onDisk = JSON.parse(
    (await import('node:fs')).readFileSync(`${srv.dataDir}/trainings.json`, 'utf-8'),
  ).find((t) => t.id === created.body.id);
  assert.equal(onDisk.draft.questions[0].type, 'single', 'persisted on disk');
  assert.equal(onDisk.draft.questions[1].type, 'multiple', 'the default is stored, not left absent');
});

test('SYS-TRN-14 / VT-151: a single-choice question with several correct answers is coerced back to multiple-choice', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Coercion',
      questions: [{ text: 'Contradiction', options: ['a', 'b', 'c'], correctIndices: [0, 2], type: 'single' }],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.draft.questions[0].type, 'multiple', 'single with several correct answers is a contradiction → multiple');
  assert.deepEqual(created.body.draft.questions[0].correctIndices, [0, 2], 'the answer key is kept intact');
});

test('SYS-TRN-14 / VT-151: an existing question without a type keeps behaving as multiple-choice', async () => {
  // A record written before the type existed (e.g. restored from a backup): the learner payload must
  // read it as multiple-choice and exact-set grading must be unchanged — the non-destructive guarantee.
  const training = await createRequiredTraining('Legacy question, no type', [
    { text: 'Legacy multi', options: ['a', 'b', 'c'], correctIndices: [0, 1] },
  ]);

  const asLearner = await srv.request('GET', `/api/trainings/${training.id}`, { token: memberToken });
  const q = asLearner.body.questions.find((x) => x.text.en === 'Legacy multi');
  assert.equal(q.type, 'multiple', 'the computed public type defaults to multiple');

  const exact = await grade(training.id, [[0, 1]]);
  assert.equal(exact.body.correct, 1, 'exact set still passes');
  const partial = await grade(training.id, [[0]]);
  assert.equal(partial.body.correct, 0, 'partial answers still fail');
});

// ───────────────────────── SYS-SES-06 — learner payload & grading ─────────────────────────

test('SYS-SES-06 / SR-150 / VT-151: the learner payload names the question type but still hides the answer key', async () => {
  const training = await createRequiredTraining('Type is public, key is not', [
    { text: 'Pick the SOP', options: ['SOP-10.00', 'SOP-10.02', 'SOP-10.03'], correctIndices: [1], type: 'single' },
  ]);

  const asLearner = await srv.request('GET', `/api/trainings/${training.id}`, { token: memberToken });
  assert.equal(asLearner.status, 200);
  const q = asLearner.body.questions.find((x) => x.text.en === 'Pick the SOP');
  assert.ok(q, 'the learner receives the question');
  assert.equal(q.type, 'single', 'the type is disclosed — the UI needs it for radio buttons');
  assert.equal('correctIndices' in q, false, 'the answer key is absent');
  assert.deepEqual(Object.keys(q).sort(), ['id', 'options', 'text', 'type'], 'nothing beyond id/text/options/type');

  // The same on the dashboard payload.
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  for (const item of mine.body) {
    for (const question of item.training.questions) {
      assert.equal('correctIndices' in question, false, 'no answer key on /mine either');
      assert.ok(question.type === 'single' || question.type === 'multiple', 'every /mine question carries a type');
    }
  }
});

test('SYS-SES-06 / VT-151: a single-choice question grades exact-match — extra API-side selections stay wrong', async () => {
  // The radio UI prevents multi-selection, but the API must not trust the client: exact set match
  // makes a multi-selection against a single-choice question wrong without any special casing.
  const training = await createRequiredTraining('Single-choice grading', [
    { text: 'Pick one', options: ['right', 'wrong', 'also wrong'], correctIndices: [0], type: 'single' },
  ]);

  const right = await grade(training.id, [[0]]);
  assert.equal(right.body.correct, 1, 'the one correct answer passes');
  assert.equal(right.body.passed, true);

  const extra = await grade(training.id, [[0, 1]]);
  assert.equal(extra.body.correct, 0, 'an API-forged multi-selection is wrong even though it contains the answer');

  const none = await grade(training.id, [[]]);
  assert.equal(none.body.correct, 0, 'an empty selection is wrong');
});

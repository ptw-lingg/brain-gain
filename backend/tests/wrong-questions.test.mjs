// Automated tests for the reveal-wrong-questions option (SYS-SET-04, SYS-SES-07).
//
// Covers the system requirements / validation tests:
//   SYS-SET-04 / SR-151 / VT-152  Settings.revealWrongQuestions — off by default, admin-toggleable
//   SYS-SES-07 / SR-151 / VT-152  when enabled, a FAILED attempt's grade response names exactly the
//                                 wrongly answered questions (indices only — never the answer key);
//                                 a passed attempt never carries them
//
// The tests in this file run in order and share one server: the first proves the default and turns
// the option ON, the later ones exercise it, and the last turns it OFF again and proves the absence.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

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

/** Create a trainer-owned training the seeded member is required to take. */
async function createRequiredTraining(name, questions) {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name, category: 'Test', durationMinutes: 60, questions },
  });
  assert.equal(created.status, 201, 'training created');

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

const setReveal = async (on) => {
  const res = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { revealWrongQuestions: on },
  });
  assert.equal(res.status, 200);
  return res.body;
};

// Three questions, one correct answer each (index 0) — one right + two wrong answers score 1/3,
// well under the 80% default threshold.
const THREE_QUESTIONS = [
  { text: 'Q1', options: ['right', 'wrong'], correctIndices: [0], type: 'single' },
  { text: 'Q2', options: ['right', 'wrong'], correctIndices: [0], type: 'single' },
  { text: 'Q3', options: ['right', 'wrong'], correctIndices: [0], type: 'single' },
];

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  trainerToken = await loginToken('trainer@braingain.app', 'trainer123');
  memberToken = await loginToken('user@braingain.app', 'user123');
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  labRoleId = roles.body.find((r) => r.name === 'Lab Technician').id;
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-SET-04 — the setting itself ─────────────────────────

test('SYS-SET-04 / SR-151 / VT-152: revealing wrong questions is off by default and admin-toggleable', async () => {
  const settings = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.revealWrongQuestions, false, 'the option defaults to off');

  // Off: even a failed attempt does not name the wrong questions.
  const training = await createRequiredTraining('Reveal off by default', THREE_QUESTIONS);
  const failed = await grade(training.id, [[0], [1], [1]]);
  assert.equal(failed.body.passed, false, 'one of three is a fail at the 80% threshold');
  assert.equal('wrongIndices' in failed.body, false, 'no wrong-question list while the option is off');

  // The admin can turn it on, and the change is reported back and persisted.
  const updated = await setReveal(true);
  assert.equal(updated.revealWrongQuestions, true);
  const readBack = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(readBack.body.revealWrongQuestions, true, 'the toggle persists');
});

// ───────────────────────── SYS-SES-07 — what a failed attempt reveals ─────────────────────────

test('SYS-SES-07 / SR-151 / VT-152: a failed attempt names exactly the wrongly answered questions when enabled', async () => {
  const training = await createRequiredTraining('Reveal on, failed attempt', THREE_QUESTIONS);

  // Q1 right, Q2 and Q3 wrong → 1/3, failed.
  const failed = await grade(training.id, [[0], [1], [1]]);
  assert.equal(failed.body.passed, false);
  assert.deepEqual(failed.body.wrongIndices, [1, 2], 'exactly the two wrong questions, by index');

  // Indices only — nothing in the response hints at the correct answers.
  assert.deepEqual(
    Object.keys(failed.body).sort(),
    ['correct', 'passThreshold', 'passed', 'scorePct', 'total', 'wrongIndices'],
    'no answer key or per-option detail sneaks into the grade response',
  );
});

test('SYS-SES-07 / VT-152: a passed attempt never names wrong questions, even when enabled and imperfect', async () => {
  // Five questions, four answered right → 80% meets the default threshold exactly: passed, and the
  // one wrong answer must NOT be revealed — the option is a fail-feedback aid, not an answer oracle.
  const five = Array.from({ length: 5 }, (_, i) => ({
    text: `P${i + 1}`, options: ['right', 'wrong'], correctIndices: [0], type: 'single',
  }));
  const training = await createRequiredTraining('Reveal on, passed attempt', five);

  const passed = await grade(training.id, [[0], [0], [0], [0], [1]]);
  assert.equal(passed.body.passed, true, '4/5 passes at the 80% threshold');
  assert.equal('wrongIndices' in passed.body, false, 'a passed attempt carries no wrong-question list');
});

test('SYS-SET-04 / SYS-SES-07 / VT-152: turning the option back off stops revealing wrong questions', async () => {
  const off = await setReveal(false);
  assert.equal(off.revealWrongQuestions, false);

  const training = await createRequiredTraining('Reveal switched off again', THREE_QUESTIONS);
  const failed = await grade(training.id, [[1], [1], [1]]);
  assert.equal(failed.body.passed, false);
  assert.equal('wrongIndices' in failed.body, false, 'the list disappears as soon as the option is off');
});

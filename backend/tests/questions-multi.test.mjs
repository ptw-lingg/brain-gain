// Automated tests for multi-answer quiz questions (SYS-TRN-12, SYS-SES-05).
//
// Covers the system requirements / validation tests:
//   SYS-TRN-12 / SR-146 / VT-146  a question may have several correct answers (correctIndices[])
//   SYS-SES-05 / SR-147 / VT-147  grading is exact set match — no partial credit, and ticking every
//                                 option does not pass; the answer count is never disclosed
//   SYS-DATA-10 / VT-148          legacy single-answer records are migrated to the multi-answer shape
//
// A trainer-owned training is created per scenario so the seeded fixtures stay untouched.

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

// ───────────────────────── SYS-SES-05 — exact set match ─────────────────────────

test('SYS-SES-05 / SR-147 / VT-147: a multi-answer question is correct only for the exact set of answers', async () => {
  const training = await createRequiredTraining('Exact set match', [
    { text: 'Which are design output?', options: ['libraries', 'drawings', 'boards', 'a wish list'], correctIndices: [0, 1, 2] },
  ]);

  const exact = await grade(training.id, [[0, 1, 2]]);
  assert.equal(exact.status, 200);
  assert.equal(exact.body.correct, 1, 'the exact set is correct');
  assert.equal(exact.body.scorePct, 1);
  assert.equal(exact.body.passed, true);

  // Order must not matter — the server normalizes the selection.
  const shuffled = await grade(training.id, [[2, 0, 1]]);
  assert.equal(shuffled.body.correct, 1, 'selection order is irrelevant');

  // Duplicates in the submission must not matter either.
  const dupes = await grade(training.id, [[0, 1, 1, 2, 2]]);
  assert.equal(dupes.body.correct, 1, 'duplicate selections are ignored');
});

test('SYS-SES-05 / SR-147 / VT-147: a partial answer is wrong — there is no partial credit', async () => {
  const training = await createRequiredTraining('No partial credit', [
    { text: 'Which are design output?', options: ['libraries', 'drawings', 'boards', 'a wish list'], correctIndices: [0, 1, 2] },
  ]);

  for (const partial of [[0], [0, 1], [1, 2]]) {
    const res = await grade(training.id, [partial]);
    assert.equal(res.body.correct, 0, `${JSON.stringify(partial)} is incomplete → wrong`);
    assert.equal(res.body.passed, false);
  }
});

test('SYS-SES-05 / SR-147 / VT-147: ticking every option does not pass a multi-answer question', async () => {
  // The obvious way to game multi-select is to select everything; exact matching defeats it.
  const training = await createRequiredTraining('Tick-everything defence', [
    { text: 'Which are design output?', options: ['libraries', 'drawings', 'boards', 'a wish list'], correctIndices: [0, 1, 2] },
  ]);

  const all = await grade(training.id, [[0, 1, 2, 3]]);
  assert.equal(all.body.correct, 0, 'the superset includes a wrong option → wrong');
  assert.equal(all.body.passed, false);
});

test('SYS-SES-05 / VT-147: selecting extra options on a single-answer question is wrong', async () => {
  const training = await createRequiredTraining('Single answer, extra ticks', [
    { text: 'Which document holds the detailed design?', options: ['SDS, CDS', 'SRS, CRS', 'MDRS'], correctIndices: [0] },
  ]);

  const justRight = await grade(training.id, [[0]]);
  assert.equal(justRight.body.correct, 1, 'the single correct answer passes');

  const tooMany = await grade(training.id, [[0, 1]]);
  assert.equal(tooMany.body.correct, 0, 'adding a wrong option makes it wrong');

  const none = await grade(training.id, [[]]);
  assert.equal(none.body.correct, 0, 'an empty selection is wrong, not correct-by-default');
});

test('SYS-SES-05 / VT-147: a bare option index is still accepted (legacy client payload)', async () => {
  const training = await createRequiredTraining('Legacy answer payload', [
    { text: 'Pick one', options: ['right', 'wrong'], correctIndices: [0] },
  ]);

  const scalar = await grade(training.id, [0]);
  assert.equal(scalar.body.correct, 1, 'a number normalizes to a one-element selection');
  const scalarWrong = await grade(training.id, [1]);
  assert.equal(scalarWrong.body.correct, 0);
});

// ───────────────────────── SYS-SES-05 — the answer count stays secret ─────────────────────────

test('SYS-SES-05 / SR-147 / VT-147: the learner payload reveals neither which answers are correct nor how many', async () => {
  const training = await createRequiredTraining('Answer count is secret', [
    { text: 'Which are design output?', options: ['libraries', 'drawings', 'boards', 'a wish list'], correctIndices: [0, 1, 2] },
  ]);

  const asLearner = await srv.request('GET', `/api/trainings/${training.id}`, { token: memberToken });
  assert.equal(asLearner.status, 200);
  const q = asLearner.body.questions.find((x) => x.text.en === 'Which are design output?');
  assert.ok(q, 'the learner receives the question');
  assert.equal('correctIndices' in q, false, 'the answer key is absent');
  assert.equal('correctIndex' in q, false, 'no legacy answer field either');
  assert.equal('correctCount' in q, false, 'the NUMBER of correct answers is not disclosed');
  // Nothing else in the payload should hint at it. The question type is deliberately public (the
  // learner UI needs it for radio vs checkbox); for a multiple-choice question it reveals nothing.
  assert.deepEqual(Object.keys(q).sort(), ['id', 'options', 'text', 'type'], 'only id/text/options/type reach a learner');

  // The same on the dashboard payload.
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  for (const item of mine.body) {
    for (const question of item.training.questions) {
      assert.equal('correctIndices' in question, false, 'no answer key on /mine either');
    }
  }
});

// ───────────────────────── SYS-DATA-10 — legacy migration ─────────────────────────

test('SYS-DATA-10 / VT-148: a legacy single-answer question is accepted and normalized on write', async () => {
  // Simulates a stored/legacy record arriving with the old scalar field: it must end up as a
  // one-element answer key, and the legacy field must not be persisted alongside it.
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Legacy shape',
      questions: [{ text: 'Legacy', options: ['a', 'b', 'c'], correctIndex: 2 }],
    },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.questions[0].correctIndices, [2], 'scalar became a one-element key');
  assert.equal(created.body.questions[0].correctIndex, undefined, 'the legacy field is dropped');

  const onDisk = JSON.parse(
    (await import('node:fs')).readFileSync(`${srv.dataDir}/trainings.json`, 'utf-8'),
  ).find((t) => t.id === created.body.id);
  assert.deepEqual(onDisk.questions[0].correctIndices, [2], 'persisted in the new shape');
  assert.equal('correctIndex' in onDisk.questions[0], false, 'nothing legacy left on disk');
});

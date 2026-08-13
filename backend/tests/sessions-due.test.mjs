// Automated tests for the Sessions & Due-status requirements (SYS areas SES + DUE):
//   SYS-SES-02  POST /api/sessions/grade — server-side grading, persist ONLY passes  (SR-051, SR-052)
//   SYS-SES-03  Unlimited retries; failed attempts not recorded                       (SR-052)
//   SYS-SES-04  GET /api/sessions/mine returns the user's passing sessions            (SR-053)
//   SYS-DUE-01  computeDue() never / up-to-date / due / overdue                       (SR-053)
//   SYS-DUE-02  GET /api/trainings/mine — required (union of roles), deduped, ordered (SR-032/060/047)
//   Validation tests: VT-051, VT-052, VT-053  (and the dashboard/derivation side of VT-050/VT-060/VT-032).
//
// Runs against a freshly-seeded, isolated backend (helpers/server.mjs). Seeded fixtures used here:
//   user@braingain.app / user123 — member holding the "Lab Technician" role, which requires
//     two trainings: "Laboratory Safety Basics" (3 questions, cycleYears 1, window −2/+1 months)
//     and "Quality Management Intro" (2 questions, cycleYears 3, window −3/+3 months).
//   settings.passThreshold = 0.8.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './helpers/server.mjs';

let srv;
let memberToken;
let memberId;
let safety; // PublicTraining: Laboratory Safety Basics (3 questions)
let quality; // PublicTraining: Quality Management Intro (2 questions)

before(async () => {
  srv = await startTestServer();

  const login = await srv.request('POST', '/api/auth/login', {
    body: { email: 'user@braingain.app', password: 'user123' },
  });
  assert.equal(login.status, 200, 'seeded member can log in');
  memberToken = login.body.token;
  memberId = login.body.user.id;

  // /trainings/mine gives the learner-facing (public) shape of the two required trainings, in order.
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.equal(mine.status, 200);
  safety = mine.body.find((d) => d.training.name.en === 'Laboratory Safety Basics').training;
  quality = mine.body.find((d) => d.training.name.en === 'Quality Management Intro').training;
  assert.ok(safety && quality, 'both seeded required trainings are present');
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-DUE-02 / SR-032 + SR-060 + SR-047 ─────────────────────────
// /trainings/mine = union of the user's roles' trainingIds, deduplicated, in admin order.

test('SYS-DUE-02 / VT-060: /trainings/mine returns the required trainings deduped and in order', async () => {
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.length, 2, 'member is required to take exactly the 2 role-derived trainings');

  // No duplicates (VT-032 derivation side: union with duplicates removed).
  const ids = mine.body.map((d) => d.training.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate trainings');

  // Order respected: seeded order is Safety (0) then Quality (1) — must match training.order ascending.
  const orders = mine.body.map((d) => d.training.order);
  assert.deepEqual([...orders].sort((a, b) => a - b), orders, 'returned in ascending admin order');
  assert.equal(mine.body[0].training.name.en, 'Laboratory Safety Basics', 'first by order');
  assert.equal(mine.body[1].training.name.en, 'Quality Management Intro', 'second by order');
});

// ───────────────────────── SYS-DUE-01 / SR-053 — "never" before any pass ─────────────────────────

test('SYS-DUE-01 / VT-053: a never-taken training reports status "never" with no due date', async () => {
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  for (const d of mine.body) {
    assert.equal(d.status, 'never', `${d.training.name.en} starts as never-taken`);
    assert.equal(d.dueDate, null, 'no due date before any pass');
    assert.equal(d.lastPassedAt, null, 'no last-passed timestamp before any pass');
  }
});

// ───────────────────────── SYS-SES-02 / SR-051 / VT-051 — answers hidden ─────────────────────────

test('SYS-SES-02 / VT-051: the learner training payload never includes correctIndices', async () => {
  // Public shape from /trainings/mine
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  for (const d of mine.body) {
    for (const q of d.training.questions) {
      assert.ok(!('correctIndices' in q), 'correctIndices stripped from /trainings/mine quiz payload');
    }
  }
  // Public shape from the single-training endpoint the Session page fetches.
  const one = await srv.request('GET', `/api/trainings/${safety.id}`, { token: memberToken });
  assert.equal(one.status, 200);
  for (const q of one.body.questions) {
    assert.ok(!('correctIndices' in q), 'correctIndices stripped from GET /trainings/:id for a non-owner');
  }
});

// ───────────────────────── SYS-SES-02 / SR-051 / VT-051 — server grades, score honest ─────────────────────────

test('SYS-SES-02 / VT-051: an all-wrong submission scores 0 and does NOT pass', async () => {
  // The seeded quizzes have no correct option at index 99, so every answer is wrong.
  const res = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: safety.id, answers: safety.questions.map(() => 99) },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.scorePct, 0, 'server computed 0% for all-wrong answers');
  assert.equal(res.body.passed, false);
  assert.equal(res.body.passThreshold, 0.8, 'threshold echoed from settings');
  assert.equal(res.body.correct, 0);
  assert.equal(res.body.total, safety.questions.length);
});

test('SYS-SES-02 / VT-051: a client-supplied score is ignored — the server recomputes from answers', async () => {
  // Try to cheat: send all-wrong answers but claim a perfect score + passed:true.
  const res = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: {
      trainingId: safety.id,
      answers: safety.questions.map(() => 99),
      scorePct: 1,
      passed: true,
      correct: safety.questions.length,
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.scorePct, 0, 'fabricated scorePct ignored');
  assert.equal(res.body.passed, false, 'fabricated passed flag ignored');

  // And nothing was persisted for the cheating (failed) attempt.
  const sessions = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  assert.equal(sessions.body.length, 0, 'a failed/cheated attempt is not recorded');
});

test('SYS-SES-02 / VT-051: a partial-but-below-threshold submission fails (0.8 threshold)', async () => {
  // Safety has 3 questions → exactly 1 correct = 33% < 80%. Get the first question right (its
  // correct option discovered via the same probing used everywhere else) and the rest wrong.
  const fullCorrect = await solve(safety);
  const answers = safety.questions.map((_q, i) => (i === 0 ? fullCorrect[0] : 99));
  const res = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: safety.id, answers },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.correct, 1, 'exactly one correct');
  assert.ok(res.body.scorePct < 0.8, 'below threshold');
  assert.equal(res.body.passed, false);
});

// ───────────────────────── SYS-SES-02 + SYS-SES-04 / SR-051 + SR-052 / VT-052 — only passes persist ─────────────────────────

test('SYS-SES-02 / SYS-SES-04 / VT-052: a passing submission is recorded and returned by /sessions/mine', async () => {
  // All-correct answers for Quality (2 questions) — discovered by brute force so the test never
  // hard-codes the seed's correctIndices (which the answer key, correctly, never exposes to us).
  const correct = await solve(quality);
  const res = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: quality.id, answers: correct },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.scorePct, 1, '100% when all answers correct');
  assert.equal(res.body.passed, true, 'passes at/above threshold');

  const sessions = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  assert.equal(sessions.status, 200);
  const forQuality = sessions.body.filter((s) => s.trainingId === quality.id);
  assert.equal(forQuality.length, 1, 'exactly one passing session persisted for Quality');
  assert.equal(forQuality[0].userId, memberId, 'session belongs to the member');
  assert.equal(forQuality[0].scorePct, 1, 'persisted scorePct matches');
  assert.ok(forQuality[0].completedAt, 'completedAt timestamp recorded');
});

test('SYS-SES-04 / SR-053: /sessions/mine returns only the calling user\'s passing sessions', async () => {
  const sessions = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  assert.equal(sessions.status, 200);
  assert.ok(Array.isArray(sessions.body));
  for (const s of sessions.body) {
    assert.equal(s.userId, memberId, 'every returned session is the member\'s own');
  }
});

// ───────────────────────── SYS-SES-03 / SR-052 / VT-052 — unlimited retries, failures never recorded ─────────────────────────

test('SYS-SES-03 / SYS-DATA-08 / VT-052: failing the same training repeatedly records nothing and leaves it due (only passes persist)', async () => {
  // Safety has never been passed yet (only Quality has). Fail it several times.
  const beforeMine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  const safetyBefore = beforeMine.body.find((d) => d.training.id === safety.id);
  assert.equal(safetyBefore.status, 'never', 'Safety still never-taken before retries');

  for (let i = 0; i < 3; i++) {
    const res = await srv.request('POST', '/api/sessions/grade', {
      token: memberToken,
      body: { trainingId: safety.id, answers: safety.questions.map(() => 99) },
    });
    assert.equal(res.body.passed, false, `retry #${i + 1} fails`);
  }

  // No Safety session persisted; due state unchanged.
  const sessions = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  assert.equal(sessions.body.filter((s) => s.trainingId === safety.id).length, 0, 'no failed attempt recorded');

  const afterMine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  const safetyAfter = afterMine.body.find((d) => d.training.id === safety.id);
  assert.equal(safetyAfter.status, 'never', 'Safety remains never-taken after failed retries');

  // Then pass it — retries are unlimited, and the eventual pass IS recorded.
  const correct = await solve(safety);
  const pass = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: safety.id, answers: correct },
  });
  assert.equal(pass.body.passed, true, 'a later attempt can still pass (unlimited retries)');
  const after = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  assert.equal(after.body.filter((s) => s.trainingId === safety.id).length, 1, 'only the passing attempt recorded');
});

// ───────────────────────── SYS-DUE-01 / SR-053 / VT-053 — up-to-date after a fresh pass ─────────────────────────

test('SYS-DUE-01 / VT-053: a just-passed training is up-to-date (due date in the future, window not yet open)', async () => {
  // Both trainings have now been passed (today). Safety cycle = 1y, window opens 2 months before due
  // (~10 months out); Quality cycle = 3y. So immediately after a fresh pass both are up-to-date.
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  for (const d of mine.body) {
    assert.equal(d.status, 'up-to-date', `${d.training.name.en} is up-to-date right after passing`);
    assert.ok(d.lastPassedAt, 'records the last passing timestamp');
    assert.ok(new Date(d.dueDate) > new Date(), 'due date is in the future');
  }
});

// ───────────────────────── SYS-DUE-01 / SR-053 / VT-053 — due & overdue via backdated passes ─────────────────────────
// completedAt can only ever be "now" via the API, so to exercise the due/overdue boundaries we write
// a backdated passing session straight into THIS test's throwaway data dir, then read it back through
// the real /trainings/mine endpoint — the computeDue() logic is exercised exactly as in production.

function seedBackdatedSession(trainingId, completedAt) {
  const sessions = [{
    id: randomUUID(),
    userId: memberId,
    trainingId,
    completedAt,
    scorePct: 1,
  }];
  writeFileSync(join(srv.dataDir, 'sessions.json'), JSON.stringify(sessions, null, 2));
}

test('SYS-DUE-01 / VT-053: a pass just inside the window reports status "due"', async () => {
  // Safety: cycleYears 1, windowBeforeMonths 2, windowAfterMonths 1.
  // A pass ~11 months ago → due date ~1 month away → inside [due−2m, due+1m] → "due".
  const elevenMonthsAgo = new Date();
  elevenMonthsAgo.setMonth(elevenMonthsAgo.getMonth() - 11);
  seedBackdatedSession(safety.id, elevenMonthsAgo.toISOString());

  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  const d = mine.body.find((x) => x.training.id === safety.id);
  assert.equal(d.status, 'due', 'inside the due window → due');
  assert.ok(d.dueDate, 'has a due date');
});

test('SYS-DUE-01 / VT-053: a long-past pass beyond the grace window reports status "overdue"', async () => {
  // Safety due date = pass + 1y; grace closes 1 month after. A pass 2 years ago is well past grace.
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  seedBackdatedSession(safety.id, twoYearsAgo.toISOString());

  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  const d = mine.body.find((x) => x.training.id === safety.id);
  assert.equal(d.status, 'overdue', 'past the grace window → overdue');
});

// ───────────────────────── grade validation guards ─────────────────────────

test('SYS-SES-02: /grade requires a string trainingId and an answers array → 400', async () => {
  const r1 = await srv.request('POST', '/api/sessions/grade', { token: memberToken, body: { answers: [] } });
  assert.equal(r1.status, 400, 'missing trainingId → 400');
  const r2 = await srv.request('POST', '/api/sessions/grade', { token: memberToken, body: { trainingId: safety.id } });
  assert.equal(r2.status, 400, 'missing answers[] → 400');
});

test('SYS-SES-02: /grade for an unknown training → 404', async () => {
  const res = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: 'no-such-training', answers: [] },
  });
  assert.equal(res.status, 404);
});

test('SYS-SES-02 / SYS-SES-04 / SR-104: the sessions API requires authentication → 401', async () => {
  const grade = await srv.request('POST', '/api/sessions/grade', { body: { trainingId: safety.id, answers: [] } });
  assert.equal(grade.status, 401, 'unauthenticated /grade rejected');
  const mine = await srv.request('GET', '/api/sessions/mine');
  assert.equal(mine.status, 401, 'unauthenticated /mine rejected');
});

// ───────────────────────── helpers ─────────────────────────

// The answer key is never exposed, so discover the all-correct answer vector by probing /grade.
// IMPORTANT: each probe submits an otherwise-all-wrong vector with a SINGLE candidate answer, so a
// probe scores at most 1/total and can never pass — discovering the key never records a session.
// The caller decides when to actually submit (and thereby pass) the assembled correct vector.
async function solve(training) {
  const n = training.questions.length;
  const answers = new Array(n).fill(99); // 99 = guaranteed-wrong sentinel
  for (let q = 0; q < n; q++) {
    const optionCount = training.questions[q].options.length;
    for (let opt = 0; opt < optionCount; opt++) {
      const trial = new Array(n).fill(99);
      trial[q] = opt; // isolate this one question against an all-wrong background
      if ((await grade(training.id, trial)).correct === 1) { answers[q] = opt; break; }
    }
  }
  return answers;
}

async function grade(trainingId, answers) {
  const res = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId, answers },
  });
  return res.body;
}

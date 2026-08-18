// Automated tests for published training updates (SYS area UPD), traced to SR-164…SR-169:
//   SYS-UPD-01  Training.version + Training.updates are server-managed model fields     (SR-164, SR-169)
//   SYS-UPD-02  POST /trainings/:id/publish-update — authz, validation, email tolerance (SR-164, SR-166)
//   SYS-UPD-03  computeDue() 'updated' overlay: audience, precedence, earliest deadline (SR-165)
//   SYS-UPD-04  Confirm-mode acknowledgements: persisted, idempotent, audited, pruned   (SR-167)
//   SYS-UPD-05  DELETE /trainings/:id/updates/:updateId — withdraw a published update   (SR-168)
//   SYS-UPD-06  Version lifecycle: starts at 1, publish increments, never rolls back    (SR-169)
//   Validation tests: VT-176 (publish endpoint), VT-177 (updated status), VT-178 (ack),
//   VT-179 (cycle precedence/reset), VT-180 (email tolerance), VT-181 (cancel), VT-182 (version).
//
// Runs against a freshly-seeded, isolated backend (helpers/server.mjs). Seeded fixtures:
//   trainer@braingain.app owns "Laboratory Safety Basics" (3 questions, cycle 1y, window −2/+1) and
//   "Quality Management Intro"; user@braingain.app holds the role requiring both. SMTP starts
//   unconfigured. Tests share one server — they run in file order and build on each other's state.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;
let memberId;
let safety; // PublicTraining: Laboratory Safety Basics
let quality; // PublicTraining: Quality Management Intro
let safetyAnswers; // the all-correct answer vector, discovered once

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `${email} can log in`);
  return res.body;
}

/** A future/past calendar day as YYYY-MM-DD (UTC). */
function day(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** The server normalizes a deadline day to end-of-day UTC. */
const endOfDay = (d) => `${d}T23:59:59.999Z`;

function publishBody(overrides = {}) {
  return {
    mode: 'confirm',
    deadline: day(10),
    emailSubject: 'Training updated',
    emailText: 'Please act on the update.',
    ...overrides,
  };
}

async function publish(trainingId, token, overrides = {}) {
  return srv.request('POST', `/api/trainings/${trainingId}/publish-update`, {
    token,
    body: publishBody(overrides),
  });
}

async function myDue(trainingId) {
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.equal(mine.status, 200);
  return mine.body.find((d) => d.training.id === trainingId);
}

before(async () => {
  srv = await startTestServer();
  adminToken = (await loginToken('admin@braingain.app', 'admin123')).token;
  trainerToken = (await loginToken('trainer@braingain.app', 'trainer123')).token;
  const member = await loginToken('user@braingain.app', 'user123');
  memberToken = member.token;
  memberId = member.user.id;

  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  assert.equal(mine.status, 200);
  safety = mine.body.find((d) => d.training.name.en === 'Laboratory Safety Basics').training;
  quality = mine.body.find((d) => d.training.name.en === 'Quality Management Intro').training;
  assert.ok(safety && quality, 'both seeded required trainings are present');
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-UPD-02 — authorization ─────────────────────────

test('SYS-UPD-02 / VT-176: publish-update requires admin or owner (401 anonymous, 403 member, 403 non-owner trainer)', async () => {
  const anon = await srv.request('POST', `/api/trainings/${safety.id}/publish-update`, { body: publishBody() });
  assert.equal(anon.status, 401, 'no token → 401');

  const member = await publish(safety.id, memberToken);
  assert.equal(member.status, 403, 'member → 403');

  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Other Trainer', email: 'trainer2@test.local', password: 'pw123456', isTrainer: true },
  });
  assert.equal(created.status, 201, 'admin creates a second trainer');
  const otherTrainerToken = (await loginToken('trainer2@test.local', 'pw123456')).token;
  const nonOwner = await publish(safety.id, otherTrainerToken);
  assert.equal(nonOwner.status, 403, 'trainer who does not own the training → 403');
});

test('SYS-UPD-02 / VT-176: publish-update validates mode, deadline and email fields (400) and the training id (404)', async () => {
  const badMode = await publish(safety.id, trainerToken, { mode: 'nudge' });
  assert.equal(badMode.status, 400, 'unknown mode → 400');

  const pastDeadline = await publish(safety.id, trainerToken, { deadline: day(-1) });
  assert.equal(pastDeadline.status, 400, 'a deadline before today → 400');

  const junkDeadline = await publish(safety.id, trainerToken, { deadline: 'soon' });
  assert.equal(junkDeadline.status, 400, 'an unparsable deadline → 400');

  const noSubject = await publish(safety.id, trainerToken, { emailSubject: '  ' });
  assert.equal(noSubject.status, 400, 'blank email subject → 400');

  const noText = await publish(safety.id, trainerToken, { emailText: '' });
  assert.equal(noText.status, 400, 'empty email text → 400');

  const unknown = await publish('no-such-training', adminToken);
  assert.equal(unknown.status, 404, 'unknown training → 404 (admin path)');

  const t = await srv.request('GET', `/api/trainings/${safety.id}`, { token: trainerToken });
  assert.equal(t.body.version ?? 1, 1, 'no failed attempt bumped the version');
  assert.equal((t.body.updates ?? []).length, 0, 'no failed attempt recorded an update');
});

// ───────────────────────── SYS-UPD-01 / SYS-UPD-06 — server-managed model ─────────────────────────

test('SYS-UPD-01 / SYS-UPD-06 / VT-182: a new training starts at version 0 (unpublished) and PUT cannot inject updates, the version or a draft', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: { en: 'Version Probe' }, durationMinutes: 5 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.version, 0, 'a new training starts unpublished (version 0)');
  assert.deepEqual(created.body.updates, [], 'a new training starts with no updates');
  assert.deepEqual(created.body.materials, [], 'no published content yet');
  assert.ok(!('draft' in created.body), 'no content in the body → no draft either');
  assert.ok(!('publishedAt' in created.body), 'no publish date before the first publish');

  const fakeUpdate = {
    id: randomUUID(),
    publishedAt: new Date().toISOString(),
    deadline: endOfDay(day(5)),
    mode: 'retake',
    publishedBy: 'attacker',
    version: 99,
  };
  const fakeDraft = {
    materials: [{ id: randomUUID(), variants: [{ locale: 'en', label: 'X', url: 'https://x.test' }] }],
    questions: [],
    savedAt: new Date().toISOString(),
  };
  const put = await srv.request('PUT', `/api/trainings/${created.body.id}`, {
    token: trainerToken,
    body: { ...created.body, version: 99, updates: [fakeUpdate], draft: fakeDraft },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.version, 0, 'version is server-managed — the body value is ignored');
  assert.deepEqual(put.body.updates, [], 'updates are server-managed — the body value is ignored');
  assert.ok(!('draft' in put.body), 'a client-supplied draft object is ignored — only body materials/questions are read');

  await srv.request('DELETE', `/api/trainings/${created.body.id}`, { token: trainerToken });
});

// ───────────────────────── SYS-UPD-02 / SYS-UPD-06 — a real publish ─────────────────────────

let confirmUpdate; // U2: the first published update (confirm mode, v2)

test('SYS-UPD-02 / SYS-UPD-06 / VT-176 / VT-182: publishing bumps the version, records the update and tolerates unconfigured SMTP', async () => {
  // The member passes Safety first, so the update will affect them.
  safetyAnswers = await solve(safety);
  const pass = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: safety.id, answers: safetyAnswers, reauth: { password: 'user123' } },
  });
  assert.equal(pass.body.passed, true, 'member passed Safety');

  const res = await publish(safety.id, trainerToken, { mode: 'confirm', deadline: day(10), note: 'New spill procedure' });
  assert.equal(res.status, 201);
  assert.equal(res.body.version, 2, 'version 1 → 2 on the first publish');
  assert.equal(res.body.update.version, 2, 'the update records the version it created');
  assert.equal(res.body.update.mode, 'confirm');
  assert.equal(res.body.update.deadline, endOfDay(day(10)), 'deadline normalized to end-of-day UTC');
  assert.equal(res.body.update.note, 'New spill procedure');
  assert.equal(res.body.affected, 1, 'exactly the one prior completer is affected');
  assert.deepEqual(res.body.email, { skipped: 'not-configured' }, 'publish succeeds although SMTP is unconfigured');
  confirmUpdate = res.body.update;

  const t = await srv.request('GET', `/api/trainings/${safety.id}`, { token: trainerToken });
  assert.equal(t.body.version, 2, 'version persisted on the training');
  assert.equal(t.body.updates.length, 1, 'update persisted on the training');
  assert.equal(t.body.publishedAt, res.body.update.publishedAt, 'the training records when the current version went live');
});

// ───────────────────────── SYS-UPD-03 — the 'updated' due state ─────────────────────────

test("SYS-UPD-03 / VT-177: a prior completer flips to 'updated' with dueDate = deadline; a never-taker stays 'never'", async () => {
  const d = await myDue(safety.id);
  assert.equal(d.status, 'updated', 'prior completer sees the update-due state');
  assert.equal(d.dueDate, confirmUpdate.deadline, 'dueDate is the update deadline');
  assert.equal(d.pendingUpdate.id, confirmUpdate.id, 'the pending update rides along');
  assert.ok(d.lastPassedAt, 'the cycle information stays present');

  const q = await myDue(quality.id);
  assert.equal(q.status, 'never', 'a never-taken training is unaffected by updates');
  assert.equal(q.pendingUpdate, null);

  // The oversight view shows the same state to the trainer.
  const groups = await srv.request('GET', '/api/trainings/trainees', { token: trainerToken });
  const safetyGroup = groups.body.find((g) => g.training.id === safety.id);
  const trainee = safetyGroup.trainees.find((x) => x.user.id === memberId);
  assert.equal(trainee.status, 'updated', 'trainees view reports the update-due state');
  assert.equal(trainee.dueDate, confirmUpdate.deadline);
});

// ───────────────────────── SYS-UPD-04 — confirm-mode acknowledgement ─────────────────────────

test("SYS-UPD-04 / VT-178: a confirm-mode acknowledgement persists, clears 'updated', is idempotent and is audited", async () => {
  const ack = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: safety.id, updateId: confirmUpdate.id },
  });
  assert.equal(ack.status, 204);

  const d = await myDue(safety.id);
  assert.equal(d.status, 'up-to-date', 'the acknowledgement cleared the update');
  assert.equal(d.pendingUpdate, null);

  // Idempotent: confirming again succeeds and records nothing new.
  const again = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: safety.id, updateId: confirmUpdate.id },
  });
  assert.equal(again.status, 204);

  const audit = await srv.request('GET', '/api/audit?action=training-update-confirmed', { token: adminToken });
  assert.equal(audit.status, 200);
  assert.equal(audit.body.total, 1, 'exactly one confirmation audit entry (idempotent repeat adds none)');
  assert.equal(audit.body.entries[0].entityId, safety.id);

  const badUpdate = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: safety.id, updateId: 'no-such-update' },
  });
  assert.equal(badUpdate.status, 404, 'unknown updateId → 404');
});

let retakeUpdate; // U3: retake mode, v3

test('SYS-UPD-04 / VT-178: an acknowledgement against a retake-mode update is rejected (400) and clears nothing', async () => {
  const res = await publish(safety.id, trainerToken, { mode: 'retake', deadline: day(14) });
  assert.equal(res.status, 201);
  assert.equal(res.body.version, 3);
  retakeUpdate = res.body.update;

  const ack = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: safety.id, updateId: retakeUpdate.id },
  });
  assert.equal(ack.status, 400, 'a retake obligation cannot be cleared by a confirmation');

  const d = await myDue(safety.id);
  assert.equal(d.status, 'updated', 'the retake update is still pending');
  assert.equal(d.pendingUpdate.id, retakeUpdate.id);
  assert.equal(d.pendingUpdate.mode, 'retake');
});

// ───────────────────────── SYS-UPD-03 — a new pass clears updates and resets the cycle ─────────────────────────

test('SYS-UPD-03 / VT-179: a new passing session clears the retake update and restarts the regular cycle', async () => {
  const pass = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: safety.id, answers: safetyAnswers, reauth: { password: 'user123' } },
  });
  assert.equal(pass.body.passed, true, 'member retook and passed Safety');

  const d = await myDue(safety.id);
  assert.equal(d.status, 'up-to-date', 'the new pass satisfied the retake update');
  assert.equal(d.pendingUpdate, null);
  assert.ok(new Date(d.dueDate) > new Date(), 'the regular cycle restarted from the new pass');

  const sessions = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  assert.equal(
    sessions.body.filter((s) => s.trainingId === safety.id).length,
    2,
    'the retake is a normal recorded session',
  );
});

test('SYS-UPD-03 / VT-177: with several pending updates the earliest deadline governs, and acking a newer confirm update never clears an older retake update', async () => {
  const retake = await publish(safety.id, trainerToken, { mode: 'retake', deadline: day(30) });
  assert.equal(retake.status, 201);
  assert.equal(retake.body.version, 4);
  const confirm = await publish(safety.id, trainerToken, { mode: 'confirm', deadline: day(5) });
  assert.equal(confirm.status, 201);
  assert.equal(confirm.body.version, 5);

  let d = await myDue(safety.id);
  assert.equal(d.status, 'updated');
  assert.equal(d.pendingUpdate.id, confirm.body.update.id, 'the earliest deadline governs');
  assert.equal(d.dueDate, confirm.body.update.deadline);

  const ack = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: safety.id, updateId: confirm.body.update.id },
  });
  assert.equal(ack.status, 204);

  d = await myDue(safety.id);
  assert.equal(d.status, 'updated', 'the older retake update surfaces next');
  assert.equal(d.pendingUpdate.id, retake.body.update.id, 'the retake update was not cleared by the ack');
});

// ───────────────────────── SYS-UPD-02 — email tolerance once SMTP is configured ─────────────────────────

test('SYS-UPD-02 / VT-180: publish succeeds when the send fails (unreachable server) and reports no-recipients when nobody passed before', async () => {
  const on = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { smtp: { enabled: true, host: '127.0.0.1', port: 59999, secure: false, username: '', password: '', fromName: 'BrainGain', fromAddress: 'no-reply@test.local' } },
  });
  assert.equal(on.status, 200);

  // Safety has an affected completer → a delivery attempt happens and fails; publish still succeeds.
  const failed = await publish(safety.id, trainerToken, { mode: 'confirm', deadline: day(20) });
  assert.equal(failed.status, 201, 'publish succeeds although the send failed');
  assert.equal(failed.body.version, 6);
  assert.deepEqual(failed.body.email, { failed: true });

  // Quality was never passed → nobody is affected, nothing to send.
  const nobody = await publish(quality.id, trainerToken, { mode: 'confirm', deadline: day(20) });
  assert.equal(nobody.status, 201);
  assert.equal(nobody.body.affected, 0);
  assert.deepEqual(nobody.body.email, { skipped: 'no-recipients' });

  const off = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { smtp: { enabled: false, host: '127.0.0.1', port: 59999, secure: false, username: '', password: '', fromName: 'BrainGain', fromAddress: 'no-reply@test.local' } },
  });
  assert.equal(off.status, 200);
});

// ───────────────────────── SYS-UPD-03 — cycle precedence ─────────────────────────

test('SYS-UPD-03 / VT-179: cycle precedence — an overdue training reports overdue, not updated, despite pending updates', async () => {
  // Backdate the member's only Safety pass to 2 years ago: the cycle (1y + 1 month grace) is long
  // overdue AND every published update now postdates the pass — the cycle status must win.
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  writeFileSync(
    join(srv.dataDir, 'sessions.json'),
    JSON.stringify(
      [{ id: randomUUID(), userId: memberId, trainingId: safety.id, completedAt: twoYearsAgo.toISOString(), scorePct: 1 }],
      null,
      2,
    ),
  );

  const d = await myDue(safety.id);
  assert.equal(d.status, 'overdue', 'cycle overdue wins over any pending update');
  assert.equal(d.pendingUpdate, null, 'no update overlay while the cycle itself demands action');
});

// ───────────────────────── SYS-UPD-05 — withdrawing an update ─────────────────────────

test('SYS-UPD-05 / SYS-UPD-06 / VT-181: cancelling an update removes it and its acknowledgements but never rolls the version back', async () => {
  const t = await srv.request('GET', `/api/trainings/${safety.id}`, { token: trainerToken });
  const acked = t.body.updates.find((u) => u.version === 5); // the confirm update acked earlier
  assert.ok(acked, 'the v5 confirm update is on the training');

  const memberCancel = await srv.request('DELETE', `/api/trainings/${safety.id}/updates/${acked.id}`, { token: memberToken });
  assert.equal(memberCancel.status, 403, 'a member cannot withdraw an update');

  const cancel = await srv.request('DELETE', `/api/trainings/${safety.id}/updates/${acked.id}`, { token: trainerToken });
  assert.equal(cancel.status, 204);

  const afterT = await srv.request('GET', `/api/trainings/${safety.id}`, { token: trainerToken });
  assert.ok(!afterT.body.updates.some((u) => u.id === acked.id), 'the update is gone');
  assert.equal(afterT.body.version, 6, 'the version stays — numbers are never reused');

  const acks = JSON.parse(readFileSync(join(srv.dataDir, 'updateAcks.json'), 'utf-8'));
  assert.ok(!acks.some((a) => a.updateId === acked.id), 'the withdrawn update\'s acknowledgements are pruned');

  const unknown = await srv.request('DELETE', `/api/trainings/${safety.id}/updates/no-such-update`, { token: trainerToken });
  assert.equal(unknown.status, 404, 'unknown update → 404');
});

// ───────────────────────── SYS-UPD-01 — legacy records ─────────────────────────

test('SYS-UPD-01 / SYS-UPD-06 / VT-182: a legacy training without a version publishes as version 2 (implicit version 1)', async () => {
  const legacy = {
    id: randomUUID(),
    name: { en: 'Legacy Shape' },
    description: {},
    durationMinutes: 30,
    category: { en: 'General' },
    ownerId: 'nobody',
    cycleYears: 1,
    windowBeforeMonths: 1,
    windowAfterMonths: 1,
    order: 999,
    materials: [],
    questions: [],
    createdAt: new Date().toISOString(),
    // deliberately NO version and NO updates — the pre-feature record shape
  };
  const path = join(srv.dataDir, 'trainings.json');
  const trainings = JSON.parse(readFileSync(path, 'utf-8'));
  trainings.push(legacy);
  writeFileSync(path, JSON.stringify(trainings, null, 2));

  const res = await publish(legacy.id, adminToken, { mode: 'confirm', deadline: day(7) });
  assert.equal(res.status, 201);
  assert.equal(res.body.version, 2, 'a missing version reads as 1, so the first publish creates v2');

  await srv.request('DELETE', `/api/trainings/${legacy.id}`, { token: adminToken });
});

// ───────────────────────── SYS-UPD-04 — cleanup on training delete ─────────────────────────

test('SYS-UPD-04 / VT-178: deleting a training removes its acknowledgements', async () => {
  const before = JSON.parse(readFileSync(join(srv.dataDir, 'updateAcks.json'), 'utf-8'));
  assert.ok(before.some((a) => a.trainingId === safety.id), 'the member\'s v2 acknowledgement still exists');

  const del = await srv.request('DELETE', `/api/trainings/${safety.id}`, { token: trainerToken });
  assert.equal(del.status, 204);

  const acks = JSON.parse(readFileSync(join(srv.dataDir, 'updateAcks.json'), 'utf-8'));
  assert.ok(!acks.some((a) => a.trainingId === safety.id), 'no acknowledgements left for the deleted training');
});

// ───────────────────────── SYS-AUD-02 — the audit trail of the feature ─────────────────────────

test('SYS-AUD-02 / SYS-UPD-02 / SYS-UPD-05 / VT-176 / VT-181: publish and cancel write audit entries with the version in the details', async () => {
  const published = await srv.request('GET', '/api/audit?action=training-update-published', { token: adminToken });
  assert.equal(published.status, 200);
  assert.ok(published.body.total >= 5, 'every publish was audited');
  assert.ok(
    published.body.entries.every((e) => /version=\d+ kind=(notify|silent)/.test(e.details)),
    'publish details carry version and kind',
  );

  const cancelled = await srv.request('GET', '/api/audit?action=training-update-cancelled', { token: adminToken });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.total, 1, 'the withdrawal was audited');
  assert.ok(/v5/.test(cancelled.body.entries[0].details), 'cancel details name the withdrawn version');
});

// ───────────────────────── helpers ─────────────────────────

// The answer key is never exposed, so discover the all-correct answer vector by probing /grade.
// Each probe submits an otherwise-all-wrong vector with a single candidate answer, so a probe can
// never pass — discovering the key never records a session (the sessions-due.test.mjs pattern).
async function solve(training) {
  const n = training.questions.length;
  const answers = new Array(n).fill(99);
  for (let q = 0; q < n; q++) {
    const optionCount = training.questions[q].options.length;
    for (let opt = 0; opt < optionCount; opt++) {
      const trial = new Array(n).fill(99);
      trial[q] = opt;
      const res = await srv.request('POST', '/api/sessions/grade', {
        token: memberToken,
        body: { trainingId: training.id, answers: trial, reauth: { password: 'user123' } },
      });
      if (res.body.correct === 1) { answers[q] = opt; break; }
    }
  }
  return answers;
}

// Automated API tests for the materials confirmation before a test (SR-162):
//   SYS-AUD-09 / VT-172  POST /api/sessions/confirm-materials appends a 'materials-confirmed' audit
//                        entry (learner actor, training entity, material count); 404/401 paths
//                        write nothing
//   SYS-SES-10 / VT-172  a training WITHOUT questions still completes: an empty grading run passes
//                        at 100%, persists the session, and is audited as training-completed
//   SYS-SES-11 / VT-174  GET /api/trainings/:id/trainer returns exactly the owner's name, email and
//                        org-unit name to any authenticated user (401 anonymous, 404 unknown)
//
// The e2e counterpart (frontend/e2e/session-confirm.spec.ts, VT-173) covers the dialog itself:
// cancel/confirm flow, the enabled start action without questions, and the completion message.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';

let srv;
let adminToken;
let memberToken;
let noQuizTraining; // created in before(): has one material, zero questions

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

const listAudit = (qs = '') => srv.request('GET', `/api/audit${qs ? `?${qs}` : ''}`, { token: adminToken });

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  memberToken = (await login('user@braingain.app', 'user123')).token;

  const created = await srv.request('POST', '/api/trainings', {
    token: adminToken,
    body: {
      name: 'Confirmation Only Training',
      materials: [{ variants: [{ locale: 'en', label: 'The one document', url: 'https://example.com/doc' }] }],
      questions: [],
    },
  });
  assert.equal(created.status, 201, 'a training with material but no questions exists');
  noQuizTraining = created.body;
  // Content lands in the draft — publish v1 so the material count and the empty grading apply.
  await publishSilent(srv, noQuizTraining.id, adminToken);
});

after(async () => { await srv?.stop(); });

test('SYS-AUD-09 / SR-162 / VT-172: confirming the materials appends an entry with the learner as actor and the material count', async () => {
  const ok = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: noQuizTraining.id },
  });
  assert.equal(ok.status, 204);

  const { body } = await listAudit('action=materials-confirmed');
  assert.equal(body.total, 1, 'exactly one confirmation so far');
  const entry = body.entries[0];
  assert.equal(entry.actor.email, 'user@braingain.app', 'the confirming learner is the actor');
  assert.equal(entry.entityType, 'training');
  assert.equal(entry.entityId, noQuizTraining.id);
  assert.equal(entry.entityName, 'Confirmation Only Training');
  assert.equal(entry.details, 'confirmed 1 material(s)', 'the provided material count is on record');
});

test('SYS-AUD-09 / SR-162 / VT-172: an unknown training is a 404 and an anonymous call a 401 — neither writes an entry', async () => {
  const before = (await listAudit('action=materials-confirmed')).body.total;

  const unknown = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: '00000000-0000-4000-8000-000000000000' },
  });
  assert.equal(unknown.status, 404);
  const missingId = await srv.request('POST', '/api/sessions/confirm-materials', { token: memberToken, body: {} });
  assert.equal(missingId.status, 400);
  const anonymous = await srv.request('POST', '/api/sessions/confirm-materials', { body: { trainingId: noQuizTraining.id } });
  assert.equal(anonymous.status, 401);

  assert.equal((await listAudit('action=materials-confirmed')).body.total, before, 'refused calls write nothing');
});

test('SYS-SES-10 / SR-162 / VT-172: grading a question-less training passes at 100%, persists the session and is audited', async () => {
  const graded = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: noQuizTraining.id, answers: [], reauth: { password: 'user123' } },
  });
  assert.equal(graded.status, 200);
  assert.equal(graded.body.passed, true, 'zero questions → nothing to fail');
  assert.equal(graded.body.scorePct, 1);
  assert.equal(graded.body.total, 0);

  // The persisted session is the durable completion evidence next to the audited confirmation.
  const mine = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  const session = mine.body.find((s) => s.trainingId === noQuizTraining.id);
  assert.ok(session, 'the completion is persisted as a TrainingSession');
  assert.equal(session.scorePct, 1);

  const audit = await listAudit(`action=training-completed&q=${encodeURIComponent('Confirmation Only Training')}`);
  assert.equal(audit.body.total, 1, 'the completion is audited');
  assert.equal(audit.body.entries[0].details, 'score 100% · signed: password', 'the completion carries the signature method');
});

test('SYS-SES-11 / SR-163 / VT-174: the trainer contact card carries exactly name, email, org unit and picture', async () => {
  // noQuizTraining was created by the admin, so the admin is its owning trainer.
  const card = await srv.request('GET', `/api/trainings/${noQuizTraining.id}/trainer`, { token: memberToken });
  assert.equal(card.status, 200, 'any authenticated user may resolve the trainer');
  assert.deepEqual(Object.keys(card.body).sort(), ['avatar', 'email', 'name', 'orgUnitName'], 'nothing but the contact card leaves the server');
  assert.equal(card.body.avatar, null, 'the seeded admin has no picture');

  // The fields match the owner's user record and their unit's name.
  const users = await srv.request('GET', '/api/users', { token: adminToken });
  const owner = users.body.find((u) => u.id === noQuizTraining.ownerId);
  const orgUnits = await srv.request('GET', '/api/org-units', { token: adminToken });
  const unitName = orgUnits.body.find((o) => o.id === owner.orgUnitId)?.name ?? '';
  assert.equal(card.body.name, owner.name);
  assert.equal(card.body.email, owner.email);
  assert.equal(card.body.orgUnitName, unitName);

  assert.equal((await srv.request('GET', `/api/trainings/${noQuizTraining.id}/trainer`)).status, 401, 'anonymous is rejected');
  const unknown = await srv.request('GET', '/api/trainings/00000000-0000-4000-8000-000000000000/trainer', { token: memberToken });
  assert.equal(unknown.status, 404);
});

// Automated tests for content reordering (SYS-TRN-18, traced to SR-174 / VT-189): materials,
// questions and answer options are presented to learners in ARRAY ORDER, so the server must
// persist them exactly in the order given — through the draft staging (PUT), the publish
// promotion, and the learner payload. The answer key travels with its options: after a reorder
// the (client-remapped) key still grades the same answers.
//
// The editor-side reorder buttons and the key remapping UI are covered in
// frontend/e2e/training-reorder.spec.ts.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';

let srv;
let trainerToken;
let memberToken;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body.token;
}

const linkMaterial = (label, url) => ({ variants: [{ locale: 'en', label, url }] });

before(async () => {
  srv = await startTestServer();
  trainerToken = await login('trainer@braingain.app', 'trainer123');
  memberToken = await login('user@braingain.app', 'user123');
});

after(async () => { await srv?.stop(); });

test('SYS-TRN-18 / SR-174 / VT-189: materials, questions and options persist in the order given, staged as a draft and promoted on publish', async () => {
  // v1: materials [First, Second]; questions [Q-one (right/wrong, key 0), Q-two].
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Reorder me',
      materials: [linkMaterial('First doc', 'https://example.com/1'), linkMaterial('Second doc', 'https://example.com/2')],
      questions: [
        { text: 'Q-one', options: ['right', 'wrong'], correctIndices: [0], type: 'single' },
        { text: 'Q-two', options: ['also right', 'also wrong'], correctIndices: [0], type: 'single' },
      ],
    },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  await publishSilent(srv, id, trainerToken);

  // The editor reorders everything: materials reversed, questions reversed, and Q-one's options
  // reversed WITH the key remapped (the client keeps the key on the same answer text).
  const draft = created.body.draft;
  const reordered = await srv.request('PUT', `/api/trainings/${id}`, {
    token: trainerToken,
    body: {
      materials: [draft.materials[1], draft.materials[0]],
      questions: [
        draft.questions[1],
        { ...draft.questions[0], options: [...draft.questions[0].options].reverse(), correctIndices: [1] },
      ],
    },
  });
  assert.equal(reordered.status, 200);
  assert.equal(reordered.body.draft.materials[0].variants[0].label, 'Second doc', 'the new material order is staged');
  assert.deepEqual(reordered.body.draft.questions.map((q) => q.text.en), ['Q-two', 'Q-one'], 'the new question order is staged');
  assert.equal(reordered.body.materials[0].variants[0].label, 'First doc', 'the published order is untouched until publish');

  // Publishing promotes the new order; the learner receives it exactly as arranged.
  await publishSilent(srv, id, trainerToken);
  const asMember = await srv.request('GET', `/api/trainings/${id}`, { token: memberToken });
  assert.deepEqual(
    asMember.body.materials.map((m) => m.variants[0].label),
    ['Second doc', 'First doc'],
    'materials arrive in the arranged order',
  );
  assert.deepEqual(asMember.body.questions.map((q) => q.text.en), ['Q-two', 'Q-one'], 'questions arrive in the arranged order');
  assert.deepEqual(
    asMember.body.questions[1].options.map((o) => o.en),
    ['wrong', 'right'],
    'options arrive in the arranged order',
  );

  // The remapped key grades the SAME answers: for Q-one, "right" now sits at index 1.
  const graded = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: id, answers: [[0], [1]], reauth: { password: 'user123' } },
  });
  assert.equal(graded.status, 200);
  assert.equal(graded.body.correct, 2, 'the key followed the reordered options');
  assert.equal(graded.body.passed, true);
});

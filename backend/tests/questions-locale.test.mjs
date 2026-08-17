// Automated API tests for LOCALIZED quiz questions and answers (SYS-DATA-12).
//
// Covers the system requirements / validation tests:
//   SYS-DATA-12 / SR-155 / VT-161  question text and every answer option are per-language maps
//                                  (locale → string, ≥1 language filled); sanitization keeps only
//                                  configured languages, drops options empty in every language with
//                                  the answer key remapped, drops questions with no text at all, and
//                                  accepts legacy plain strings as the English entry; legacy records
//                                  are migrated to the localized shape at boot. Grading stays on
//                                  option indices — untouched by the display language.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer, publishSilent } from './helpers/server.mjs';

let srv;
let trainerToken;

before(async () => {
  srv = await startTestServer();
  const res = await srv.request('POST', '/api/auth/login', {
    body: { email: 'trainer@braingain.app', password: 'trainer123' },
  });
  trainerToken = res.body.token;
});

after(async () => { await srv?.stop(); });

test('SYS-DATA-12 / SR-155 / VT-161: a question round-trips with per-language text and answers', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Localized question',
      questions: [
        {
          text: { de: 'Wozu dient der Prozess?', en: 'What is the purpose of the process?' },
          options: [
            { de: 'Anforderungen festlegen', en: 'To define requirements' },
            { de: 'Werbung erstellen', en: 'To create marketing' },
          ],
          correctIndices: [0],
          type: 'single',
        },
      ],
    },
  });
  assert.equal(created.status, 201);
  const q = created.body.draft.questions[0]; // content is staged until published
  assert.deepEqual(q.text, { de: 'Wozu dient der Prozess?', en: 'What is the purpose of the process?' });
  assert.deepEqual(q.options[0], { de: 'Anforderungen festlegen', en: 'To define requirements' });
  assert.deepEqual(q.correctIndices, [0], 'the answer key is language-independent');
});

test('SYS-DATA-12 / VT-161: unknown languages are dropped, empty options are removed with the key remapped, textless questions vanish', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Question sanitize rules',
      questions: [
        {
          text: { en: 'Keep me', fr: 'Gardez-moi' }, // fr is not configured (default en+de)
          options: [
            { en: '' }, // empty in every language → dropped
            { en: 'right answer' },
            { en: 'wrong answer' },
          ],
          correctIndices: [1], // points at 'right answer' — must survive the removal shift
        },
        { text: {}, options: [{ en: 'orphan' }], correctIndices: [0] }, // no text in any language → question dropped
      ],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.draft.questions.length, 1, 'the textless question is dropped');
  const q = created.body.draft.questions[0];
  assert.deepEqual(q.text, { en: 'Keep me' }, 'the unconfigured language is dropped');
  assert.deepEqual(q.options, [{ en: 'right answer' }, { en: 'wrong answer' }], 'the all-empty option is gone');
  assert.deepEqual(q.correctIndices, [0], 'the answer key was remapped to the surviving option');
});

test('SYS-DATA-12 / SR-155 / VT-161: grading is unaffected by the display language', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Grading is index-based',
      questions: [
        {
          text: { de: 'Frage', en: 'Question' },
          options: [{ de: 'richtig', en: 'right' }, { de: 'falsch', en: 'wrong' }],
          correctIndices: [0],
          type: 'single',
        },
      ],
    },
  });
  assert.equal(created.status, 201);
  await publishSilent(srv, created.body.id, trainerToken); // grading works on published content
  // The trainer grades their own quiz — grade only needs the training id and index answers.
  const right = await srv.request('POST', '/api/sessions/grade', {
    token: trainerToken,
    body: { trainingId: created.body.id, answers: [[0]] },
  });
  assert.equal(right.body.correct, 1, 'index answers grade identically whatever language was displayed');
});

test('SYS-DATA-12 / SR-155 / VT-161: legacy plain-string questions are migrated to the localized shape at boot', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'braingain-qmigrate-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  const serverA = await startTestServer({ env: { DATA_DIR: dataDir } });
  await serverA.stop(); // dataDir survives — stop() removes only the helper's own temp dir

  const file = join(dataDir, 'trainings.json');
  const trainings = JSON.parse(readFileSync(file, 'utf-8'));
  trainings[0].questions = [
    { id: 'legacy-q', text: 'Plain old question', options: ['a', 'b'], correctIndices: [1] },
  ];
  writeFileSync(file, JSON.stringify(trainings, null, 2), 'utf-8');

  const serverB = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const token = (await serverB.request('POST', '/api/auth/login', {
      body: { email: 'trainer@braingain.app', password: 'trainer123' },
    })).body.token;
    const res = await serverB.request('GET', `/api/trainings/${trainings[0].id}`, { token });
    assert.equal(res.status, 200);
    const q = res.body.questions.find((x) => x.id === 'legacy-q');
    assert.deepEqual(q.text, { en: 'Plain old question' }, 'the string text became the English entry');
    assert.deepEqual(q.options, [{ en: 'a' }, { en: 'b' }], 'string options localized too');
    assert.deepEqual(q.correctIndices, [1], 'the answer key is untouched');
  } finally {
    await serverB.stop();
  }
});

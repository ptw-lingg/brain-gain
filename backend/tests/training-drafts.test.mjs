// Automated tests for draft/published separation of training content (SYS-UPD-07/08/09, traced to
// SR-170…SR-172): trainees see and use ONLY the last published version — editor edits are staged
// as a draft on the training until published (notify or silent), version 0 means "never published"
// (not completable by any path), and a draft can be discarded.
//   VT-183  draft staging & published-only visibility (incl. audit masking + reboot survival)
//   VT-184  silent publish (promotion, gating, kind default)
//   VT-185  unpublished trainings cannot be completed
//   VT-186  discard a draft (authz, revert, audit, byte cleanup)
//
// Runs against a freshly-seeded, isolated backend (helpers/server.mjs). The seeded trainings are
// published v1; trainings created here start unpublished (version 0) with their content staged.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer, publishSilent } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;
let labRoleId;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

const linkMaterial = (url) => [{ variants: [{ locale: 'en', label: 'Doc', url }] }];

async function createTraining(body, token = trainerToken) {
  const created = await srv.request('POST', '/api/trainings', { token, body });
  assert.equal(created.status, 201, 'training created');
  return created.body;
}

async function assignToMember(trainingId) {
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  const lab = roles.body.find((r) => r.id === labRoleId);
  const upd = await srv.request('PUT', `/api/roles/${labRoleId}`, {
    token: adminToken,
    body: { name: lab.name, trainingIds: [...lab.trainingIds, trainingId] },
  });
  assert.equal(upd.status, 200, 'training assigned to the Lab Technician role');
}

/** Upload raw bytes to POST /materials (the JSON request() helper can't send octet-streams). */
async function upload(bytes, token) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/materials?name=f.bin`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: bytes,
  });
  assert.equal(res.status, 201, 'upload accepted');
  return JSON.parse(await res.text());
}

async function downloadStatus(id, token) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/materials/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  await res.arrayBuffer();
  return res.status;
}

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  trainerToken = (await login('trainer@braingain.app', 'trainer123')).token;
  memberToken = (await login('user@braingain.app', 'user123')).token;
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  labRoleId = roles.body.find((r) => r.name === 'Lab Technician').id;
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-UPD-07 — staging ─────────────────────────

test('SYS-UPD-07 / SR-170 / VT-183: POST routes content into the draft — version 0, published content empty, savedAt stamped', async () => {
  const created = await createTraining({
    name: 'Staged from birth',
    materials: linkMaterial('https://example.com/v1'),
    questions: [{ text: 'Q', options: ['right', 'wrong'], correctIndices: [0], type: 'single' }],
  });
  assert.equal(created.version, 0, 'never published yet');
  assert.deepEqual(created.materials, [], 'no published materials');
  assert.deepEqual(created.questions, [], 'no published questions');
  assert.equal(created.draft.materials.length, 1, 'the content is staged');
  assert.equal(created.draft.questions.length, 1);
  assert.ok(created.draft.savedAt, 'the draft is timestamped');
});

test('SYS-UPD-07 / SR-170 / VT-183: a learner never receives the draft — every learner read serves the published content only', async () => {
  const created = await createTraining({ name: 'Published v1, drafted v2', materials: linkMaterial('https://example.com/v1') });
  await publishSilent(srv, created.id, trainerToken);
  await assignToMember(created.id);
  const put = await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { materials: linkMaterial('https://example.com/WIP') },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.draft.materials[0].variants[0].url, 'https://example.com/WIP', 'the WIP is staged');

  // GET /:id — the session page's read.
  const one = await srv.request('GET', `/api/trainings/${created.id}`, { token: memberToken });
  assert.equal(one.body.materials[0].variants[0].url, 'https://example.com/v1', 'the member sees the published content');
  assert.ok(!('draft' in one.body), 'no draft field on the learner payload');

  // GET /trainings — the list read (public shape for non-owners).
  const list = await srv.request('GET', '/api/trainings', { token: memberToken });
  const inList = list.body.find((t) => t.id === created.id);
  assert.equal(inList.materials[0].variants[0].url, 'https://example.com/v1');
  assert.ok(!('draft' in inList));

  // GET /mine — the dashboard read.
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  const item = mine.body.find((d) => d.training.id === created.id);
  assert.equal(item.training.materials[0].variants[0].url, 'https://example.com/v1');
  assert.ok(!('draft' in item.training));

  // The owner keeps seeing the WIP.
  const asOwner = await srv.request('GET', `/api/trainings/${created.id}`, { token: trainerToken });
  assert.equal(asOwner.body.draft.materials[0].variants[0].url, 'https://example.com/WIP');
});

test('SYS-UPD-07 / VT-183: PUT stages content while metadata goes live; content equal to published clears the draft; an unchanged draft keeps its savedAt', async () => {
  const created = await createTraining({ name: 'Staging rules', materials: linkMaterial('https://example.com/base') });
  await publishSilent(srv, created.id, trainerToken);

  // Metadata + unchanged content → live rename, still no draft.
  const published = (await srv.request('GET', `/api/trainings/${created.id}`, { token: trainerToken })).body;
  const rename = await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { name: 'Staging rules (renamed)', materials: published.materials, questions: published.questions },
  });
  assert.deepEqual(rename.body.name, { en: 'Staging rules (renamed)' }, 'metadata applies immediately');
  assert.ok(!('draft' in rename.body), 'content equal to the published version needs no draft');

  // Content change → staged; the published fields are untouched.
  const stage = await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { materials: linkMaterial('https://example.com/next') },
  });
  assert.equal(stage.body.materials[0].variants[0].url, 'https://example.com/base', 'published content untouched');
  const savedAt = stage.body.draft.savedAt;
  assert.ok(savedAt);

  // A metadata-only re-save with the same content keeps the draft object (and its savedAt).
  const resave = await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { name: 'Staging rules (renamed again)', materials: stage.body.draft.materials, questions: stage.body.draft.questions },
  });
  assert.equal(resave.body.draft.savedAt, savedAt, 'an unchanged draft keeps its savedAt');

  // Editing the content back to the published state discards the draft.
  const revert = await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { materials: published.materials, questions: published.questions },
  });
  assert.ok(!('draft' in revert.body), 'content equal to published clears the draft');
});

test("SYS-AUD-02 / SYS-UPD-07 / VT-183: a content-staging PUT audits a masked 'draft' change — the answer key never reaches the log", async () => {
  const created = await createTraining({ name: 'Audit masking probe' });
  const put = await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { questions: [{ text: 'Secret Q', options: ['right', 'wrong'], correctIndices: [0] }] },
  });
  assert.equal(put.status, 200);
  const audit = await srv.request(
    'GET',
    `/api/audit?entityType=training&action=update&q=${encodeURIComponent('Audit masking probe')}`,
    { token: adminToken },
  );
  const change = audit.body.entries[0].changes.find((c) => c.field === 'draft');
  assert.deepEqual({ from: change.from, to: change.to }, { from: '***', to: '***' }, 'the draft diff is masked wholesale');
  assert.ok(!audit.body.entries[0].changes.some((c) => c.field === 'questions'), 'no unmasked questions field');
});

// ───────────────────────── SYS-UPD-08 — publishing kinds & gating ─────────────────────────

test('SYS-UPD-08 / SR-171 / VT-184: a silent publish promotes the draft, bumps 0→1, clears it and creates no obligation', async () => {
  const created = await createTraining({ name: 'Silently live', materials: linkMaterial('https://example.com/live') });
  const res = await publishSilent(srv, created.id, trainerToken);
  assert.deepEqual(res, { version: 1 }, 'a silent publish reports only the new version — no update, no email');

  const readBack = await srv.request('GET', `/api/trainings/${created.id}`, { token: trainerToken });
  assert.equal(readBack.body.version, 1);
  assert.equal(readBack.body.materials[0].variants[0].url, 'https://example.com/live', 'the draft was promoted');
  assert.ok(!('draft' in readBack.body), 'the draft is cleared');
  assert.deepEqual(readBack.body.updates, [], 'no obligation was recorded');
});

test('SYS-UPD-08 / SR-171 / VT-184: silent without a draft → 400, notify at version 0 → 400, an unknown kind → 400, kind defaults to notify', async () => {
  // Silent with nothing staged has nothing to do.
  const published = await createTraining({ name: 'Nothing to publish', materials: linkMaterial('https://example.com/x') });
  await publishSilent(srv, published.id, trainerToken);
  const emptySilent = await srv.request('POST', `/api/trainings/${published.id}/publish-update`, {
    token: trainerToken,
    body: { kind: 'silent' },
  });
  assert.equal(emptySilent.status, 400, 'silent without a draft → 400');

  // Nobody can be notified about a training nobody could have taken.
  const unpublished = await createTraining({ name: 'Never published', materials: linkMaterial('https://example.com/y') });
  const notifyBody = {
    mode: 'confirm',
    deadline: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    emailSubject: 'S',
    emailText: 'T',
  };
  const notifyAtV0 = await srv.request('POST', `/api/trainings/${unpublished.id}/publish-update`, {
    token: trainerToken,
    body: notifyBody,
  });
  assert.equal(notifyAtV0.status, 400, 'notify at version 0 → 400');

  const badKind = await srv.request('POST', `/api/trainings/${published.id}/publish-update`, {
    token: trainerToken,
    body: { kind: 'shout' },
  });
  assert.equal(badKind.status, 400, 'unknown kind → 400');

  // Without a kind the endpoint behaves exactly as before this feature: notify.
  const defaulted = await srv.request('POST', `/api/trainings/${published.id}/publish-update`, {
    token: trainerToken,
    body: notifyBody,
  });
  assert.equal(defaulted.status, 201);
  assert.ok(defaulted.body.update, 'kind defaults to notify — an update obligation is recorded');
  assert.equal(defaulted.body.version, 2);
});

test('SYS-UPD-08 / SR-171 / VT-184: a notify publish with a draft promotes the content AND creates the obligation', async () => {
  const created = await createTraining({
    name: 'Promote and oblige',
    materials: linkMaterial('https://example.com/first'),
    questions: [{ text: 'Q', options: ['right', 'wrong'], correctIndices: [0], type: 'single' }],
  });
  await publishSilent(srv, created.id, trainerToken);
  await assignToMember(created.id);
  const pass = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: created.id, answers: [[0]], reauth: { password: 'user123' } },
  });
  assert.equal(pass.body.passed, true, 'the member passed v1');

  const put = await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { materials: linkMaterial('https://example.com/second') },
  });
  assert.equal(put.status, 200);
  const res = await srv.request('POST', `/api/trainings/${created.id}/publish-update`, {
    token: trainerToken,
    body: {
      kind: 'notify',
      mode: 'confirm',
      deadline: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      emailSubject: 'Updated',
      emailText: 'Please confirm.',
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.version, 2);
  assert.equal(res.body.affected, 1, 'the prior completer is affected');

  const asMember = await srv.request('GET', `/api/trainings/${created.id}`, { token: memberToken });
  assert.equal(asMember.body.materials[0].variants[0].url, 'https://example.com/second', 'the promoted content is live');
  const mine = await srv.request('GET', '/api/trainings/mine', { token: memberToken });
  const item = mine.body.find((d) => d.training.id === created.id);
  assert.equal(item.status, 'updated', 'the obligation was created');
});

// ───────────────────────── SYS-UPD-08 — version 0 is not completable ─────────────────────────

test('SYS-UPD-08 / SR-170 / VT-185: grading an unpublished training is refused (409) and persists no session; the confirmation stays evidence-only', async () => {
  const created = await createTraining({ name: 'Uncompletable', materials: linkMaterial('https://example.com/wip') });
  const graded = await srv.request('POST', '/api/sessions/grade', {
    token: memberToken,
    body: { trainingId: created.id, answers: [] },
  });
  assert.equal(graded.status, 409, 'no published version → nothing to complete (the empty-quiz auto-pass is closed)');

  const sessions = await srv.request('GET', '/api/sessions/mine', { token: memberToken });
  assert.ok(!sessions.body.some((s) => s.trainingId === created.id), 'no session was persisted');

  // The materials confirmation persists nothing (audit-only) — completion evidence comes from /grade alone.
  const confirm = await srv.request('POST', '/api/sessions/confirm-materials', {
    token: memberToken,
    body: { trainingId: created.id },
  });
  assert.equal(confirm.status, 204);
});

// ───────────────────────── SYS-UPD-09 — discarding a draft ─────────────────────────

test('SYS-UPD-09 / SR-172 / VT-186: discarding a draft requires the owner, reverts to the published state, is audited and 404s when there is nothing to discard', async () => {
  const created = await createTraining({ name: 'Discard me', materials: linkMaterial('https://example.com/keep') });
  await publishSilent(srv, created.id, trainerToken);
  await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { materials: linkMaterial('https://example.com/scrap') },
  });

  const anon = await srv.request('DELETE', `/api/trainings/${created.id}/draft`);
  assert.equal(anon.status, 401, 'anonymous → 401');
  const member = await srv.request('DELETE', `/api/trainings/${created.id}/draft`, { token: memberToken });
  assert.equal(member.status, 403, 'member → 403');
  const otherTrainer = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Other Trainer', email: 'trainer2@drafts.local', password: 'pw123456', isTrainer: true },
  });
  assert.equal(otherTrainer.status, 201);
  const otherToken = (await login('trainer2@drafts.local', 'pw123456')).token;
  const nonOwner = await srv.request('DELETE', `/api/trainings/${created.id}/draft`, { token: otherToken });
  assert.equal(nonOwner.status, 403, 'non-owner trainer → 403');

  const discard = await srv.request('DELETE', `/api/trainings/${created.id}/draft`, { token: trainerToken });
  assert.equal(discard.status, 204);
  const readBack = await srv.request('GET', `/api/trainings/${created.id}`, { token: trainerToken });
  assert.ok(!('draft' in readBack.body), 'the draft is gone');
  assert.equal(readBack.body.materials[0].variants[0].url, 'https://example.com/keep', 'the published content stands');

  const audit = await srv.request(
    'GET',
    `/api/audit?action=training-draft-discarded&q=${encodeURIComponent('Discard me')}`,
    { token: adminToken },
  );
  assert.equal(audit.body.total, 1, 'the discard is audited');

  const again = await srv.request('DELETE', `/api/trainings/${created.id}/draft`, { token: trainerToken });
  assert.equal(again.status, 404, 'nothing left to discard → 404');
});

test('SYS-UPD-09 / SYS-TRN-11 / VT-186: discarding a draft deletes draft-only file bytes but never published ones', async () => {
  const fileA = await upload(Buffer.from('published bytes'), trainerToken);
  const created = await createTraining({
    name: 'Byte discard',
    materials: [{ variants: [{ locale: 'en', file: fileA }] }],
  });
  await publishSilent(srv, created.id, trainerToken);

  const fileB = await upload(Buffer.from('draft-only bytes'), trainerToken);
  const materialId = created.draft.materials[0].id;
  await srv.request('PUT', `/api/trainings/${created.id}`, {
    token: trainerToken,
    body: { materials: [{ id: materialId, variants: [{ locale: 'en', file: fileB }] }] },
  });
  assert.equal(await downloadStatus(fileB.id, trainerToken), 200, 'the draft upload is on disk');

  const discard = await srv.request('DELETE', `/api/trainings/${created.id}/draft`, { token: trainerToken });
  assert.equal(discard.status, 204);
  assert.equal(await downloadStatus(fileB.id, trainerToken), 404, 'the draft-only upload is deleted');
  assert.equal(await downloadStatus(fileA.id, trainerToken), 200, 'the published upload is untouched');
});

// ───────────────────────── SYS-UPD-07 — the migration never promotes version 0 ─────────────────────────

test('SYS-UPD-07 / VT-183: version 0 survives a reboot — the boot migration never promotes an unpublished training', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'braingain-drafts-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  const serverA = await startTestServer({ env: { DATA_DIR: dataDir } });
  const trainerA = (await (async () => {
    const r = await serverA.request('POST', '/api/auth/login', { body: { email: 'trainer@braingain.app', password: 'trainer123' } });
    return r.body;
  })()).token;
  const created = await serverA.request('POST', '/api/trainings', {
    token: trainerA,
    body: { name: 'Reboot probe', materials: [{ variants: [{ locale: 'en', label: 'Doc', url: 'https://example.com/wip' }] }] },
  });
  assert.equal(created.body.version, 0);
  await serverA.stop(); // dataDir survives — stop() removes only the helper's own temp dir

  const serverB = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const trainerB = (await (async () => {
      const r = await serverB.request('POST', '/api/auth/login', { body: { email: 'trainer@braingain.app', password: 'trainer123' } });
      return r.body;
    })()).token;
    const readBack = await serverB.request('GET', `/api/trainings/${created.body.id}`, { token: trainerB });
    assert.equal(readBack.body.version, 0, 'the reboot migration left version 0 alone');
    assert.ok(readBack.body.draft, 'the draft survived the reboot');
    const graded = await serverB.request('POST', '/api/sessions/grade', {
      token: trainerB,
      body: { trainingId: created.body.id, answers: [] },
    });
    assert.equal(graded.status, 409, 'still not completable after the reboot');
  } finally {
    await serverB.stop();
  }
});

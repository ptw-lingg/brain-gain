// Automated API tests for the training PREVIEW IMAGE — the cover of the learner's training card.
//
// Covers the system requirements / validation tests:
//   SYS-TRN-20  Training.previewImage: an uploaded raster image referenced by descriptor, validated
//               against the STORED upload (UUID id, image type, ≤ 5 MB), applied immediately by
//               POST/PUT (master data — never draft-staged), cleared by null, bytes deleted when
//               replaced / removed / the training is deleted, carried to learners. (← SR-185)
//   SR-185 / VT-219  a trainer gives a training a preview image; learners receive it with the card
//   SR-045  deleting a training deletes its files
//
// Uploads use a raw octet-stream body (the JSON request() helper can't), like materials.test.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';

let srv;
let trainerToken;
let memberToken;

// A real 1×1 PNG — the bytes that come back must equal these.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

async function upload(bytes, { name, type, token }) {
  const qs = new URLSearchParams({ name, type });
  const res = await fetch(`${srv.baseUrl}/api/trainings/materials?${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
}

async function download(id, token) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/materials/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
}

const uploadPng = (name = 'cover.png') => upload(PNG_1PX, { name, type: 'image/png', token: trainerToken });

before(async () => {
  srv = await startTestServer();
  trainerToken = (await login('trainer@braingain.app', 'trainer123')).token;
  memberToken = (await login('user@braingain.app', 'user123')).token;
});

after(async () => { await srv?.stop(); });

test('SYS-TRN-20 / SR-185 / VT-219: a trainer gives a training a preview image and a learner receives it with the card data', async () => {
  const up = await uploadPng();
  assert.equal(up.status, 201);

  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Radiation Safety', previewImage: up.body },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.previewImage.id, up.body.id, 'the descriptor is stored on the training');
  assert.equal(created.body.previewImage.type, 'image/png');
  assert.equal(created.body.draft, undefined, 'a cover image is master data — nothing is staged');

  // The learner payload carries the descriptor (toPublic keeps master data)…
  const asMember = await srv.request('GET', `/api/trainings/${created.body.id}`, { token: memberToken });
  assert.equal(asMember.status, 200);
  assert.equal(asMember.body.previewImage.id, up.body.id);

  // …and the learner can fetch the bytes to render the cover.
  const down = await download(up.body.id, memberToken);
  assert.equal(down.status, 200);
  assert.ok(PNG_1PX.equals(down.bytes), 'the image bytes round-trip');
  assert.equal(down.type, 'image/png');
});

test('SYS-TRN-20: a non-image upload cannot become the preview image → 400', async () => {
  const up = await upload(Buffer.from('<svg onload="alert(1)"/>'), { name: 'cover.svg', type: 'image/svg+xml', token: trainerToken });
  assert.equal(up.status, 201, 'the upload itself is fine — any file may be a material');
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'SVG Cover', previewImage: up.body },
  });
  assert.equal(created.status, 400);
  assert.match(created.body.error, /image/i);

  const pdf = await upload(Buffer.from('%PDF-1.4'), { name: 'doc.pdf', type: 'application/pdf', token: trainerToken });
  const withPdf = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'PDF Cover', previewImage: pdf.body },
  });
  assert.equal(withPdf.status, 400);
});

test('SYS-TRN-20: a forged preview-image descriptor is refused → 400 (non-UUID id, unknown id, client-claimed type)', async () => {
  const nonUuid = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Forged', previewImage: { id: '../../etc/passwd', name: 'x.png', size: 1, type: 'image/png' } },
  });
  assert.equal(nonUuid.status, 400);

  const unknown = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Forged', previewImage: { id: '11111111-2222-4333-8444-555555555555', name: 'x.png', size: 1, type: 'image/png' } },
  });
  assert.equal(unknown.status, 400);

  // The stored sidecar decides, not the descriptor the client sends along.
  const text = await upload(Buffer.from('plain text'), { name: 'notes.txt', type: 'text/plain', token: trainerToken });
  const relabelled = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Relabelled', previewImage: { ...text.body, type: 'image/png' } },
  });
  assert.equal(relabelled.status, 400);
});

test('SYS-TRN-20: replacing the preview image deletes the old bytes; an explicit null removes the image and its bytes', async () => {
  const first = await uploadPng('first.png');
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Replace Me', previewImage: first.body },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  // A metadata-only PUT without the field keeps the image (present-or-keep).
  const kept = await srv.request('PUT', `/api/trainings/${id}`, { token: trainerToken, body: { durationMinutes: 30 } });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.previewImage.id, first.body.id);

  const second = await uploadPng('second.png');
  const replaced = await srv.request('PUT', `/api/trainings/${id}`, { token: trainerToken, body: { previewImage: second.body } });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.previewImage.id, second.body.id);
  assert.equal(replaced.body.draft, undefined, 'still nothing staged');
  assert.equal((await download(first.body.id, trainerToken)).status, 404, 'the replaced bytes are gone');
  assert.equal((await download(second.body.id, trainerToken)).status, 200);

  const cleared = await srv.request('PUT', `/api/trainings/${id}`, { token: trainerToken, body: { previewImage: null } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.previewImage, undefined, 'the field is dropped, not nulled');
  assert.equal((await download(second.body.id, trainerToken)).status, 404, 'the removed bytes are gone');
});

test('SYS-TRN-20 / SR-185: setting the preview image on a published training changes neither version nor draft', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Published',
      materials: [{ variants: [{ locale: 'en', label: 'Handbook', url: 'https://example.org/handbook' }] }],
    },
  });
  assert.equal(created.status, 201);
  await publishSilent(srv, created.body.id, trainerToken);

  const up = await uploadPng();
  const updated = await srv.request('PUT', `/api/trainings/${created.body.id}`, {
    token: trainerToken,
    body: { previewImage: up.body },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.version, 1, 'no new version');
  assert.equal(updated.body.draft, undefined, 'no draft — learners see the cover right away');
  assert.equal(updated.body.previewImage.id, up.body.id);
});

test('SYS-TRN-20 / SR-045: deleting a training removes its preview image bytes', async () => {
  const up = await uploadPng();
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Delete Me', previewImage: up.body },
  });
  assert.equal(created.status, 201);
  assert.equal((await download(up.body.id, trainerToken)).status, 200);

  const del = await srv.request('DELETE', `/api/trainings/${created.body.id}`, { token: trainerToken });
  assert.equal(del.status, 204);
  assert.equal((await download(up.body.id, trainerToken)).status, 404);
});

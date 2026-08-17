// Automated API tests for training learning-material FILE uploads (SYS-TRN-11).
//
// Covers the system requirements / validation tests:
//   SYS-TRN-11  POST /api/trainings/materials — trainer/admin upload of any file type; raw bytes in the
//               body, name/type as query params; returns { id, name, size, type }.
//               GET /api/trainings/materials/:fileId — streams the stored bytes to any authenticated
//               user as a download; the fileId is UUID-validated against path traversal. (← SR-041)
//   SYS-DATA-11 file variants keep only descriptors whose id is a real (UUID) upload (← SR-041)
//   SR-041 / VT-041  uploaded files round-trip and are downloadable by a learner (member)
//   VT-104  upload is gated to trainer/admin; download requires authentication
//
// Uploads use a raw octet-stream body (the JSON request() helper can't), so these go through fetch()
// directly against srv.baseUrl. The helper module already disables TLS verification for the dev cert.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

/** Upload raw bytes to POST /materials. Returns { status, body }. */
async function upload(bytes, { name, type, token } = {}) {
  const qs = new URLSearchParams();
  if (name != null) qs.set('name', name);
  if (type != null) qs.set('type', type);
  const res = await fetch(`${srv.baseUrl}/api/trainings/materials?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: bytes,
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  return { status: res.status, body };
}

/** Download GET /materials/:id. Returns { status, bytes, headers }. */
async function download(id, { token } = {}) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/materials/${id}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes, headers: res.headers };
}

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  trainerToken = (await login('trainer@braingain.app', 'trainer123')).token;
  memberToken = (await login('user@braingain.app', 'user123')).token;
});

after(async () => { await srv?.stop(); });

// ───────────────────────── upload access control & validation ─────────────────────────

test('SYS-TRN-11 / VT-104: a plain member cannot upload a material file → 403', async () => {
  const res = await upload(Buffer.from('nope'), { name: 'x.txt', type: 'text/plain', token: memberToken });
  assert.equal(res.status, 403);
});

test('SYS-TRN-11 / VT-104: uploading without a token → 401', async () => {
  const res = await upload(Buffer.from('nope'), { name: 'x.txt' });
  assert.equal(res.status, 401);
});

test('SYS-TRN-11: an empty upload → 400', async () => {
  const res = await upload(Buffer.alloc(0), { name: 'empty.bin', token: trainerToken });
  assert.equal(res.status, 400);
});

// ───────────────────────── round-trip: upload → download ─────────────────────────

test('SYS-TRN-11 / SR-041 / VT-041: a trainer uploads a file and downloads it back byte-for-byte', async () => {
  const content = Buffer.from('Lab safety handbook — section 1.\nWear PPE.\n');
  const up = await upload(content, { name: 'handbook.pdf', type: 'application/pdf', token: trainerToken });
  assert.equal(up.status, 201);
  assert.ok(UUID_RE.test(up.body.id), 'a UUID id is assigned');
  assert.equal(up.body.name, 'handbook.pdf');
  assert.equal(up.body.size, content.length);
  assert.equal(up.body.type, 'application/pdf');

  const down = await download(up.body.id, { token: trainerToken });
  assert.equal(down.status, 200);
  assert.ok(content.equals(down.bytes), 'downloaded bytes match the uploaded bytes');
  assert.equal(down.headers.get('content-type'), 'application/pdf');
  assert.match(down.headers.get('content-disposition') ?? '', /attachment/, 'served as a download, not inline');
  assert.match(down.headers.get('content-disposition') ?? '', /handbook\.pdf/, 'keeps the original filename');
});

test('SYS-TRN-11: a JSON file round-trips intact (raw body is not parsed as a JSON request)', async () => {
  // A .json upload reports content type application/json; it must still be stored verbatim and not be
  // swallowed by the JSON body parser. The descriptor type comes from the query param we send.
  const content = Buffer.from('{"answers":[1,2,3],"note":"not a request body"}');
  const up = await upload(content, { name: 'data.json', type: 'application/json', token: adminToken });
  assert.equal(up.status, 201);
  const down = await download(up.body.id, { token: memberToken });
  assert.equal(down.status, 200);
  assert.ok(content.equals(down.bytes), 'JSON file bytes round-trip unchanged');
});

// ───────────────────────── download id validation ─────────────────────────

test('SYS-TRN-11: a non-UUID file id is rejected → 400 (path-traversal guard)', async () => {
  const res = await download('not-a-uuid', { token: trainerToken });
  assert.equal(res.status, 400);
});

test('SYS-TRN-11: a well-formed but unknown file id → 404', async () => {
  const res = await download('00000000-0000-4000-8000-000000000000', { token: trainerToken });
  assert.equal(res.status, 404);
});

test('SYS-TRN-11 / VT-104: downloading without a token → 401', async () => {
  const up = await upload(Buffer.from('auth check'), { name: 'a.txt', token: trainerToken });
  const res = await download(up.body.id);
  assert.equal(res.status, 401);
});

// ───────────────────────── attach to a training & learner access ─────────────────────────

test('SYS-TRN-11 / SR-041: an uploaded file attached to a training is visible & downloadable by a learner', async () => {
  const content = Buffer.from('procedure steps');
  const up = await upload(content, { name: 'procedure.docx', type: 'application/octet-stream', token: trainerToken });

  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'With A File',
      materials: [{ variants: [{ locale: 'en', label: 'Procedure', file: up.body }] }],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.draft.materials.length, 1, 'the material is staged on the training');
  assert.equal(created.body.draft.materials[0].variants[0].file.id, up.body.id);

  // The content reaches learners once the first version is published…
  await publishSilent(srv, created.body.id, trainerToken);

  // A member fetching the training sees the file descriptor (carried by the public shape)…
  const asMember = await srv.request('GET', `/api/trainings/${created.body.id}`, { token: memberToken });
  assert.equal(asMember.status, 200);
  assert.equal(asMember.body.materials[0].variants[0].file.name, 'procedure.docx');

  // …and can download it (learners study material).
  const down = await download(up.body.id, { token: memberToken });
  assert.equal(down.status, 200);
  assert.ok(content.equals(down.bytes));
});

// ───────────────────────── file-variant sanitization ─────────────────────────

test('SYS-DATA-11: file variants are sanitized — forged/non-UUID descriptors are dropped', async () => {
  const up = await upload(Buffer.from('real bytes'), { name: 'real.bin', token: trainerToken });

  const res = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Sanitize Files',
      materials: [
        { variants: [{ locale: 'en', label: 'Real', file: up.body }] }, // a real, stored upload — kept
        { variants: [{ locale: 'en', label: 'Fake', file: { id: 'not-a-uuid', name: 'fake.exe', size: 9, type: 'x' } }] }, // bad id → file dropped → variant empty → material dropped
        { variants: [{ locale: 'en', file: { id: '11111111-1111-4111-8111-111111111111', name: 5, size: 'big', type: null } }] }, // valid id shape, junk fields coerced
        'garbage',
      ],
    },
  });
  assert.equal(res.status, 201);
  const materials = res.body.draft.materials; // staged until published
  assert.equal(materials.length, 2, 'only materials with a surviving UUID-id descriptor remain');
  assert.equal(materials[0].variants[0].file.id, up.body.id);
  assert.deepEqual(
    materials[1].variants[0],
    { locale: 'en', label: 'file', file: { id: '11111111-1111-4111-8111-111111111111', name: 'file', size: 0, type: '' } },
    'non-string name → "file"; non-numeric size → 0; null type → ""; empty label defaults to the file name',
  );
});

// ───────────────────────── delete cleanup ─────────────────────────

test('SYS-TRN-11 / SR-045: deleting a training removes its uploaded files from disk', async () => {
  const up = await upload(Buffer.from('to be cleaned up'), { name: 'temp.bin', token: trainerToken });
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Cleanup Me', materials: [{ variants: [{ locale: 'en', file: up.body }] }] },
  });
  assert.equal(created.status, 201);

  // The file is downloadable while the training exists.
  assert.equal((await download(up.body.id, { token: trainerToken })).status, 200);

  const del = await srv.request('DELETE', `/api/trainings/${created.body.id}`, { token: trainerToken });
  assert.equal(del.status, 204);

  // After deletion the bytes are gone.
  assert.equal((await download(up.body.id, { token: trainerToken })).status, 404);
});

// Automated API tests for the SCORM package COVER CANDIDATE (SYS-SCO-15, traced to SR-185).
//
// Neither SCORM nor LOM defines a cover image, so the import reads vendor conventions — Articulate
// Storyline's meta.xml (`<project thumburl="…">`) first, then a conventionally named image file —
// and records a validated candidate on the package descriptor. It is only OFFERED to the trainer
// (the editor applies it through the normal preview-image upload on click), never applied by itself.
//
//   SYS-SCO-15  thumbnailHref detection (Storyline meta.xml, filename convention), raster-only,
//               containment-checked, size-capped; GET /scorm-packages/:id/thumbnail serves it inline
//               to trainers/admins; packages without a candidate carry null and answer 404. Records
//               from before the field existed are scanned on disk at boot (migrateScormThumbnails).
//   SR-185 / VT-219  the trainer decides whether the package picture becomes the card's cover.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/server.mjs';
import { buildScorm12 } from './helpers/scormFixture.mjs';

let srv;
let trainerToken;
let memberToken;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
// Storyline's vendor metadata, as exported (BOM included), pointing at the first-slide thumbnail.
const storylineMeta = (thumburl) =>
  `﻿<?xml version="1.0" encoding="utf-8"?><meta><project id="x" courseid="y" thumburl="${thumburl}" title="Course" version="1.0.0.0"><description>d</description></project></meta>`;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

async function upload(bytes, { name = 'course.zip', token } = {}) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/scorm-packages?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: bytes,
  });
  return { status: res.status, body: await res.json() };
}

async function thumbnail(packageId, token) {
  const res = await fetch(`${srv.baseUrl}/api/trainings/scorm-packages/${packageId}/thumbnail`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

before(async () => {
  srv = await startTestServer();
  trainerToken = (await login('trainer@braingain.app', 'trainer123')).token;
  memberToken = (await login('user@braingain.app', 'user123')).token;
});

after(async () => srv.stop());

test('SYS-SCO-15 / SR-185 / VT-219: a Storyline export declares its thumbnail in meta.xml — the import records it and serves it inline to the trainer', async () => {
  const zip = await buildScorm12({
    extraFiles: {
      'meta.xml': storylineMeta('story_content/thumbnail.jpg'),
      'story_content/thumbnail.jpg': PNG_1PX,
    },
  });
  const up = await upload(zip, { token: trainerToken, name: 'storyline.zip' });
  assert.equal(up.status, 201);
  assert.equal(up.body.thumbnailHref, 'story_content/thumbnail.jpg');

  const thumb = await thumbnail(up.body.packageId, trainerToken);
  assert.equal(thumb.status, 200);
  assert.ok(PNG_1PX.equals(thumb.bytes), 'the package bytes are served unchanged');
  assert.equal(thumb.headers.get('content-type'), 'image/jpeg', 'typed by extension, like package content');
  assert.equal(thumb.headers.get('content-disposition'), 'inline');
  assert.equal(thumb.headers.get('x-content-type-options'), 'nosniff');

  // Only trainers/admins see package internals; a learner gets 403 here as on every package route.
  assert.equal((await thumbnail(up.body.packageId, memberToken)).status, 403);
  assert.equal((await thumbnail(up.body.packageId)).status, 401);
});

test('SYS-SCO-15: without vendor metadata a conventionally named image is the candidate, shallowest first', async () => {
  const zip = await buildScorm12({
    extraFiles: { 'assets/deep/cover.png': PNG_1PX, 'poster.jpg': PNG_1PX, 'img/photo.png': PNG_1PX },
  });
  const up = await upload(zip, { token: trainerToken });
  assert.equal(up.status, 201);
  assert.equal(up.body.thumbnailHref, 'poster.jpg');
});

test('SYS-SCO-15: a package with no cover candidate carries null and its thumbnail route answers 404', async () => {
  const up = await upload(await buildScorm12({ extraFiles: { 'img/photo.png': PNG_1PX } }), { token: trainerToken });
  assert.equal(up.status, 201);
  assert.equal(up.body.thumbnailHref, null, 'scanned, nothing qualifies');
  assert.equal((await thumbnail(up.body.packageId, trainerToken)).status, 404);
});

test('SYS-SCO-15: an unsafe or non-raster meta.xml hint is ignored (path escape, SVG, missing file) — the convention fallback still applies', async () => {
  const escape = await upload(
    await buildScorm12({ extraFiles: { 'meta.xml': storylineMeta('../../etc/passwd.png'), 'cover.png': PNG_1PX } }),
    { token: trainerToken },
  );
  assert.equal(escape.status, 201);
  assert.equal(escape.body.thumbnailHref, 'cover.png', 'the escaping hint is dropped, the safe fallback wins');

  const svg = await upload(
    await buildScorm12({ extraFiles: { 'meta.xml': storylineMeta('logo.svg'), 'logo.svg': '<svg onload="alert(1)"/>' } }),
    { token: trainerToken },
  );
  assert.equal(svg.status, 201);
  assert.equal(svg.body.thumbnailHref, null, 'SVG is never a cover candidate');

  const missing = await upload(
    await buildScorm12({ extraFiles: { 'meta.xml': storylineMeta('story_content/thumbnail.jpg') } }),
    { token: trainerToken },
  );
  assert.equal(missing.status, 201);
  assert.equal(missing.body.thumbnailHref, null, 'a hint at a file the package lacks is no candidate');
});

test('SYS-SCO-15: a nested (single-folder) export resolves the candidate relative to the package root', async () => {
  const up = await upload(
    await buildScorm12({ nested: true, extraFiles: { 'meta.xml': storylineMeta('story_content/thumbnail.jpg'), 'story_content/thumbnail.jpg': PNG_1PX } }),
    { token: trainerToken },
  );
  assert.equal(up.status, 201);
  assert.equal(up.body.thumbnailHref, 'story_content/thumbnail.jpg');
  assert.equal((await thumbnail(up.body.packageId, trainerToken)).status, 200);
});

test('SYS-SCO-15: packages imported before the field existed are scanned on disk at the next boot (migrateScormThumbnails)', async () => {
  // Import two packages on a first server, then strip the field from the store — the shape of a
  // record written by a release that did not know about cover candidates.
  const first = await startTestServer();
  const loginOn = async (s) =>
    (await s.request('POST', '/api/auth/login', { body: { email: 'trainer@braingain.app', password: 'trainer123' } })).body.token;
  const uploadOn = async (s, token, bytes) => {
    const res = await fetch(`${s.baseUrl}/api/trainings/scorm-packages?name=legacy.zip`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
      body: bytes,
    });
    assert.equal(res.status, 201);
    return (await res.json()).packageId;
  };
  const firstToken = await loginOn(first);
  const withCover = await uploadOn(first, firstToken, await buildScorm12({
    extraFiles: { 'meta.xml': storylineMeta('story_content/thumbnail.jpg'), 'story_content/thumbnail.jpg': PNG_1PX },
  }));
  const plain = await uploadOn(first, firstToken, await buildScorm12({}));
  // stop() deletes its data dir, so the "old release's" data is a copy taken while it is still there.
  const dataDir = mkdtempSync(join(tmpdir(), 'braingain-legacy-'));
  cpSync(first.dataDir, dataDir, { recursive: true });
  await first.stop();

  const storePath = join(dataDir, 'scormPackages.json');
  const legacy = JSON.parse(readFileSync(storePath, 'utf8'));
  for (const pkg of legacy) delete pkg.thumbnailHref;
  writeFileSync(storePath, JSON.stringify(legacy, null, 2));

  // The next boot on that data dir backfills the field from the extracted directories.
  const second = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const migrated = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(migrated.find((p) => p.packageId === withCover).thumbnailHref, 'story_content/thumbnail.jpg');
    assert.equal(migrated.find((p) => p.packageId === plain).thumbnailHref, null, 'scanned once, nothing found → null, never rescanned');

    const secondToken = await loginOn(second);
    const res = await fetch(`${second.baseUrl}/api/trainings/scorm-packages/${withCover}/thumbnail`, {
      headers: { authorization: `Bearer ${secondToken}` },
    });
    assert.equal(res.status, 200, 'the backfilled candidate is served');
    assert.ok(PNG_1PX.equals(Buffer.from(await res.arrayBuffer())));
  } finally {
    await second.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

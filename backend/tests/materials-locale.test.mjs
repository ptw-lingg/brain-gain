// Automated API tests for LOCALIZED learning material (SYS-DATA-11).
//
// Covers the system requirements / validation tests:
//   SYS-DATA-11 / SR-152 / VT-154  a material is a group of per-locale variants, each with its own
//                                  label and its own content (url or uploaded file); sanitization
//                                  drops unknown-locale and content-less variants, keeps at most one
//                                  variant per locale, and a material with no surviving variant is
//                                  dropped entirely (the ≥1-variant rule)
//   SYS-DATA-11 / SR-152 / VT-155  legacy materialLinks/materialFiles records are migrated to
//                                  single-English-variant materials at boot
//   SYS-TRN-11                     replacing/removing a file variant deletes the replaced upload
//
// Uploads use a raw octet-stream body (the JSON request() helper can't), so those go through fetch()
// directly against srv.baseUrl.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/server.mjs';

let srv;
let trainerToken;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body.token;
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
  return { status: res.status, body: JSON.parse(await res.text()) };
}

const downloadStatus = async (id, token) => {
  const res = await fetch(`${srv.baseUrl}/api/trainings/materials/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  await res.arrayBuffer();
  return res.status;
};

before(async () => {
  srv = await startTestServer();
  trainerToken = await login('trainer@braingain.app', 'trainer123');
});

after(async () => { await srv?.stop(); });

// ───────────────────────── per-locale variants ─────────────────────────

test('SYS-DATA-11 / SR-152 / VT-154: a material round-trips with per-locale variants — own label and content per locale', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Localized material',
      materials: [
        {
          variants: [
            { locale: 'de', label: 'Sicherheitshandbuch', url: 'https://docs.example.com/handbuch' },
            { locale: 'en', label: 'Safety Handbook', url: 'https://docs.example.com/handbook' },
          ],
        },
      ],
    },
  });
  assert.equal(created.status, 201);
  const material = created.body.materials[0];
  assert.ok(material.id, 'the material got a stable server-assigned id');
  // Variants come back ordered by the settings list (en before de by default catalog order).
  assert.deepEqual(material.variants, [
    { locale: 'en', label: 'Safety Handbook', url: 'https://docs.example.com/handbook' },
    { locale: 'de', label: 'Sicherheitshandbuch', url: 'https://docs.example.com/handbuch' },
  ]);

  // A PUT that does not touch materials keeps them; one that does replaces them wholesale.
  const updated = await srv.request('PUT', `/api/trainings/${created.body.id}`, {
    token: trainerToken,
    body: { ...created.body },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.materials, created.body.materials, 'the material survives an update round-trip');
});

test('SYS-DATA-11 / VT-154: a variant holds exactly one content — an uploaded file wins over a url', async () => {
  const up = await upload(Buffer.from('bytes'), { name: 'doc.pdf', type: 'application/pdf', token: trainerToken });
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'File beats url',
      materials: [
        { variants: [{ locale: 'en', label: 'Both', url: 'https://example.com/ignored', file: up.body }] },
      ],
    },
  });
  assert.equal(created.status, 201);
  const variant = created.body.materials[0].variants[0];
  assert.equal(variant.file.id, up.body.id, 'the file is kept');
  assert.equal('url' in variant, false, 'the url is dropped — one content per variant');
});

test('SYS-DATA-11 / VT-154: unknown-locale variants are dropped and duplicate locales keep the first variant', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Locale rules',
      materials: [
        {
          variants: [
            { locale: 'fr', label: 'Français', url: 'https://example.com/fr' }, // fr is not configured (default en+de)
            { locale: 'en', label: 'First', url: 'https://example.com/first' },
            { locale: 'en', label: 'Second', url: 'https://example.com/second' }, // duplicate → dropped
          ],
        },
        { variants: [{ locale: 'fr', label: 'Only fr', url: 'https://example.com/only-fr' }] }, // nothing survives → material dropped
      ],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.materials.length, 1, 'the material with no configured-locale variant is dropped');
  assert.deepEqual(created.body.materials[0].variants, [
    { locale: 'en', label: 'First', url: 'https://example.com/first' },
  ]);
});

// ───────────────────────── byte cleanup on save ─────────────────────────

test('SYS-TRN-11 / SYS-DATA-11: replacing a file variant deletes the replaced upload from disk', async () => {
  const first = await upload(Buffer.from('v1'), { name: 'v1.bin', token: trainerToken });
  const second = await upload(Buffer.from('v2'), { name: 'v2.bin', token: trainerToken });

  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Replace file', materials: [{ variants: [{ locale: 'en', file: first.body }] }] },
  });
  assert.equal(created.status, 201);
  assert.equal(await downloadStatus(first.body.id, trainerToken), 200);

  const updated = await srv.request('PUT', `/api/trainings/${created.body.id}`, {
    token: trainerToken,
    body: { materials: [{ id: created.body.materials[0].id, variants: [{ locale: 'en', file: second.body }] }] },
  });
  assert.equal(updated.status, 200);
  assert.equal(await downloadStatus(second.body.id, trainerToken), 200, 'the new upload is served');
  assert.equal(await downloadStatus(first.body.id, trainerToken), 404, 'the replaced upload is gone from disk');
});

// ───────────────────────── legacy migration ─────────────────────────

test('SYS-DATA-11 / SR-152 / VT-155: legacy materialLinks/materialFiles are migrated to English variants at boot', async (t) => {
  // Boot a server against our OWN data dir (extraEnv overrides the helper's temp dir), let it seed,
  // rewrite trainings.json into the pre-locale shape, then boot again: the migration must convert
  // every legacy entry into a single-English-variant material and drop the legacy fields.
  const dataDir = mkdtempSync(join(tmpdir(), 'braingain-migrate-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  const serverA = await startTestServer({ env: { DATA_DIR: dataDir } });
  await serverA.stop(); // stop() removes only the helper's unused temp dir — dataDir survives

  const file = join(dataDir, 'trainings.json');
  const trainings = JSON.parse(readFileSync(file, 'utf-8'));
  trainings[0].materialLinks = [
    { label: 'Legacy Handbook', url: 'https://docs.example.com/legacy' },
    { label: '', url: '' }, // fully empty legacy row — carries nothing, not migrated
  ];
  trainings[0].materialFiles = [
    { id: '22222222-2222-4222-8222-222222222222', name: 'legacy.pdf', size: 123, type: 'application/pdf' },
  ];
  delete trainings[0].materials;
  // SYS-DATA-04: a legacy hour-based duration is converted to minutes by the same migration run.
  trainings[0].durationHours = 1.5;
  delete trainings[0].durationMinutes;
  writeFileSync(file, JSON.stringify(trainings, null, 2), 'utf-8');

  const serverB = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const token = (await serverB.request('POST', '/api/auth/login', {
      body: { email: 'trainer@braingain.app', password: 'trainer123' },
    })).body.token;
    const res = await serverB.request('GET', `/api/trainings/${trainings[0].id}`, { token });
    assert.equal(res.status, 200);
    const materials = res.body.materials;
    assert.equal(materials.length, 2, 'one link + one file migrated; the empty legacy row is dropped');
    assert.deepEqual(materials[0].variants, [
      { locale: 'en', label: 'Legacy Handbook', url: 'https://docs.example.com/legacy' },
    ]);
    assert.equal(materials[1].variants[0].locale, 'en');
    assert.equal(materials[1].variants[0].label, 'legacy.pdf', 'a migrated file variant is named after the file');
    assert.equal(materials[1].variants[0].file.id, '22222222-2222-4222-8222-222222222222');
    assert.equal('materialLinks' in res.body, false, 'legacy fields are gone from the API payload');

    const onDisk = JSON.parse(readFileSync(file, 'utf-8')).find((x) => x.id === trainings[0].id);
    assert.equal('materialLinks' in onDisk, false, 'nothing legacy left on disk');
    assert.equal('materialFiles' in onDisk, false);
    assert.equal(onDisk.materials.length, 2);
    assert.equal(onDisk.durationMinutes, 90, 'SYS-DATA-04: 1.5 legacy hours became 90 minutes');
    assert.equal('durationHours' in onDisk, false, 'the legacy duration field is gone');
  } finally {
    await serverB.stop();
  }
});

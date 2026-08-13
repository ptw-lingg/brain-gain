// Automated API tests for LOCALIZED training master data (SYS-DATA-13).
//
// Covers the system requirements / validation tests:
//   SYS-DATA-13 / SR-157 / VT-164  a training's name/description/category are per-language maps
//                                  (locale → string); sanitization keeps only configured languages,
//                                  accepts legacy plain strings as the English entry, and a training
//                                  must keep at least one language of name (create without one → 400);
//                                  legacy plain-string records are migrated to the localized shape
//                                  at boot.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/server.mjs';

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

test('SYS-DATA-13 / SR-157 / VT-164: name, description and category round-trip as per-language maps', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: { de: 'SOP-20.00 Beschaffung', en: 'SOP-20.00 Procurement' },
      description: { de: 'Beschaffungsprozess', en: 'Procurement process' },
      category: { de: 'Allgemein', en: 'General' },
    },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.name, { de: 'SOP-20.00 Beschaffung', en: 'SOP-20.00 Procurement' });
  assert.deepEqual(created.body.description, { de: 'Beschaffungsprozess', en: 'Procurement process' });
  assert.deepEqual(created.body.category, { de: 'Allgemein', en: 'General' });

  // Read back via a separate request — the maps were persisted, not just echoed.
  const readBack = await srv.request('GET', `/api/trainings/${created.body.id}`, { token: trainerToken });
  assert.equal(readBack.status, 200);
  assert.deepEqual(readBack.body.name, { de: 'SOP-20.00 Beschaffung', en: 'SOP-20.00 Procurement' });
});

test('SYS-DATA-13 / SR-157 / VT-164: sanitization keeps configured languages only; a nameless create → 400', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: { en: 'Keep me', fr: 'Gardez-moi', de: '   ' }, // fr unconfigured; blank de dropped
      description: { fr: 'seulement français' }, // nothing configured survives → empty map
      category: { de: 'Sicherheit' },
    },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.name, { en: 'Keep me' }, 'unconfigured and blank languages are dropped');
  assert.deepEqual(created.body.description, {}, 'a field may legitimately end up empty in every language');
  assert.deepEqual(created.body.category, { de: 'Sicherheit' }, 'a German-only category is fine');

  // The name is the one field that must keep at least one language.
  for (const name of [undefined, '', '   ', {}, { fr: 'sans nom' }, { en: '  ' }]) {
    const res = await srv.request('POST', '/api/trainings', {
      token: trainerToken,
      body: { name, description: 'has everything but a name' },
    });
    assert.equal(res.status, 400, `a create with name=${JSON.stringify(name)} is refused`);
  }
});

test('SYS-DATA-13 / SR-157 / VT-164: legacy plain-string fields coerce to the English entry on write; PUT keeps absent fields', async () => {
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: { name: 'Plain Name', description: 'Plain description', category: 'Plain Category' },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.name, { en: 'Plain Name' });
  assert.deepEqual(created.body.description, { en: 'Plain description' });
  assert.deepEqual(created.body.category, { en: 'Plain Category' });

  // PUT: a present field is sanitized (string or map), an absent one keeps its stored value.
  const updated = await srv.request('PUT', `/api/trainings/${created.body.id}`, {
    token: trainerToken,
    body: { name: { en: 'Plain Name', de: 'Schlichter Name' }, category: 'Renamed Category' },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.name, { en: 'Plain Name', de: 'Schlichter Name' });
  assert.deepEqual(updated.body.category, { en: 'Renamed Category' }, 'a legacy string still coerces on update');
  assert.deepEqual(updated.body.description, { en: 'Plain description' }, 'an omitted field keeps its current value');
});

test('SYS-DATA-13 / SR-157 / VT-164: legacy plain-string records are migrated to the localized shape at boot', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'braingain-tmigrate-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  const serverA = await startTestServer({ env: { DATA_DIR: dataDir } });
  await serverA.stop(); // dataDir survives — stop() removes only the helper's own temp dir

  const file = join(dataDir, 'trainings.json');
  const trainings = JSON.parse(readFileSync(file, 'utf-8'));
  trainings[0].name = 'Plain old training';
  trainings[0].description = ''; // an empty legacy string becomes an empty map, not { en: '' }
  trainings[0].category = 'Old Category';
  writeFileSync(file, JSON.stringify(trainings, null, 2), 'utf-8');

  const serverB = await startTestServer({ env: { DATA_DIR: dataDir } });
  try {
    const token = (await serverB.request('POST', '/api/auth/login', {
      body: { email: 'trainer@braingain.app', password: 'trainer123' },
    })).body.token;
    const res = await serverB.request('GET', `/api/trainings/${trainings[0].id}`, { token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.name, { en: 'Plain old training' }, 'the string name became the English entry');
    assert.deepEqual(res.body.description, {}, 'the empty description became an empty map');
    assert.deepEqual(res.body.category, { en: 'Old Category' }, 'the string category localized too');

    // The migration normalized the STORE, not just the payload — and left the other records alone.
    const onDisk = JSON.parse(readFileSync(file, 'utf-8'));
    assert.deepEqual(onDisk[0].name, { en: 'Plain old training' });
    assert.deepEqual(onDisk[1].name, { en: 'Quality Management Intro' }, 'already-localized records are untouched');
  } finally {
    await serverB.stop();
  }
});

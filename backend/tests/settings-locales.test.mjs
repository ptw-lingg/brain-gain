// Automated API tests for the material-language list in Settings (SYS-SET-05).
//
// Covers the system requirements / validation tests:
//   SYS-SET-05 / SR-153 / VT-157  Settings.materialLocales — defaults to English + German; grows only
//                                 from the predefined catalog; English (the default and fallback) can
//                                 never be removed; a locale still used by any material variant is
//                                 protected by a transparent 409 naming the language and its usage.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `${email} can log in`);
  return res.body.token;
}

const putLocales = (materialLocales) =>
  srv.request('PUT', '/api/settings', { token: adminToken, body: { materialLocales } });

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  trainerToken = await loginToken('trainer@braingain.app', 'trainer123');
});

after(async () => { await srv?.stop(); });

test('SYS-SET-05 / SR-153: the material-language list defaults to English + German', async () => {
  const res = await srv.request('GET', '/api/settings', { token: trainerToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.materialLocales, ['en', 'de']);
});

test('SYS-SET-05 / SR-153 / VT-157: a catalog language can be added; unknown codes are rejected (400)', async () => {
  const added = await putLocales(['en', 'de', 'fr']);
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.materialLocales, ['en', 'de', 'fr'], 'stored in catalog order');

  const unknown = await putLocales(['en', 'de', 'fr', 'xx']);
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /xx/, 'the refusal names the unknown code');

  const junk = await putLocales('not-an-array');
  assert.equal(junk.status, 400);
});

test('SYS-SET-05 / SR-153 / VT-157: English is the default and fallback and cannot be removed (400)', async () => {
  const res = await putLocales(['de', 'fr']);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /English/, 'the refusal explains why');

  const readBack = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.ok(readBack.body.materialLocales.includes('en'), 'en is still in the list');
});

test('SYS-SET-05 / SR-153 / VT-157: removing a language still used by a material is refused with a transparent 409', async () => {
  // A trainer authors a material with a French variant…
  const created = await srv.request('POST', '/api/trainings', {
    token: trainerToken,
    body: {
      name: 'Uses French',
      materials: [{ variants: [{ locale: 'fr', label: 'Manuel', url: 'https://docs.example.com/fr' }] }],
    },
  });
  assert.equal(created.status, 201);

  // …so French cannot be removed, and the refusal says exactly what stands in the way.
  const refused = await putLocales(['en', 'de']);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Français \(fr\)/, 'the message names the language');
  assert.match(refused.body.error, /1 material in 1 training/, 'the message names the usage');

  const readBack = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.ok(readBack.body.materialLocales.includes('fr'), 'fr is still configured after the refusal');

  // Once the material is gone, the language is unused and removal succeeds.
  const del = await srv.request('DELETE', `/api/trainings/${created.body.id}`, { token: trainerToken });
  assert.equal(del.status, 204);
  const removed = await putLocales(['en', 'de']);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.materialLocales, ['en', 'de'], 'an unused language can be removed');
});

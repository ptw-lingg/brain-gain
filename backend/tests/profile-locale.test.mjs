// Automated API tests for the persisted per-user profile: locale and UI prefs (SYS-AUTH-10).
//
// Covers the system requirements / validation tests:
//   SYS-AUTH-10 / SR-154 / VT-159  PUT /api/auth/me { locale?, prefs? } — the only self-service
//                                  profile write. Persists the user's language (UI locales en/de
//                                  only) and the whitelisted boolean UI preference flags (the
//                                  "show only due" filters), which every identity payload (login,
//                                  /me) then carries; refused with 403 during impersonation
//                                  because the token belongs to the target user.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let memberToken;
let memberId;

async function login(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `${email} can log in`);
  return res.body;
}

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  const member = await login('user@braingain.app', 'user123');
  memberToken = member.token;
  memberId = member.user.id;
});

after(async () => { await srv?.stop(); });

test('SYS-AUTH-10 / SR-154 / VT-159: PUT /api/auth/me persists the profile locale and every identity payload carries it', async () => {
  // A fresh account has no locale yet — the client falls back to its own detection.
  const before = await srv.request('GET', '/api/auth/me', { token: memberToken });
  assert.equal(before.body.locale, undefined, 'no locale until the user picks one');

  const put = await srv.request('PUT', '/api/auth/me', { token: memberToken, body: { locale: 'de' } });
  assert.equal(put.status, 200);
  assert.equal(put.body.locale, 'de', 'the response is the fresh identity payload');

  const me = await srv.request('GET', '/api/auth/me', { token: memberToken });
  assert.equal(me.body.locale, 'de', '/me returns the stored locale');

  const relogin = await login('user@braingain.app', 'user123');
  assert.equal(relogin.user.locale, 'de', 'the login payload carries it — the UI applies it at sign-in');
});

test('SYS-AUTH-10 / VT-159: locales outside the UI set are rejected (400); unauthenticated writes 401', async () => {
  // fr is a valid MATERIAL language but the UI only exists in en/de — the profile is the UI language.
  const invalid = await srv.request('PUT', '/api/auth/me', { token: memberToken, body: { locale: 'fr' } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /en, de/, 'the refusal lists the allowed values');

  const missing = await srv.request('PUT', '/api/auth/me', { token: memberToken, body: {} });
  assert.equal(missing.status, 400);

  const anonymous = await srv.request('PUT', '/api/auth/me', { body: { locale: 'de' } });
  assert.equal(anonymous.status, 401);
});

test('SYS-AUTH-10 / SR-095 / VT-U12: PUT /api/auth/me persists the only-due preference flags, merged per key', async () => {
  // No prefs until a filter is first toggled.
  const before = await srv.request('GET', '/api/auth/me', { token: memberToken });
  assert.equal(before.body.prefs, undefined, 'no prefs until the user flips a filter');

  const put = await srv.request('PUT', '/api/auth/me', {
    token: memberToken,
    body: { prefs: { dashboardOnlyDue: false } },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.prefs.dashboardOnlyDue, false, 'the response is the fresh identity payload');

  // A second write to a DIFFERENT key merges — the first flag survives.
  const merge = await srv.request('PUT', '/api/auth/me', {
    token: memberToken,
    body: { prefs: { traineesOnlyDue: false } },
  });
  assert.equal(merge.status, 200);
  assert.deepEqual(merge.body.prefs, { dashboardOnlyDue: false, traineesOnlyDue: false });

  const relogin = await login('user@braingain.app', 'user123');
  assert.deepEqual(
    relogin.user.prefs,
    { dashboardOnlyDue: false, traineesOnlyDue: false },
    'the login payload carries the stored prefs — the UI restores the filters at sign-in',
  );

  // Restore for the tests below / test isolation.
  await srv.request('PUT', '/api/auth/me', {
    token: memberToken,
    body: { prefs: { dashboardOnlyDue: true, traineesOnlyDue: true } },
  });
});

test('SYS-AUTH-10 / VT-U12: unknown pref keys and non-boolean values are rejected (400) without writing', async () => {
  const unknown = await srv.request('PUT', '/api/auth/me', {
    token: memberToken,
    body: { prefs: { somethingElse: true } },
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /dashboardOnlyDue/, 'the refusal lists the allowed flags');

  const nonBool = await srv.request('PUT', '/api/auth/me', {
    token: memberToken,
    body: { prefs: { dashboardOnlyDue: 'yes' } },
  });
  assert.equal(nonBool.status, 400);

  const notObject = await srv.request('PUT', '/api/auth/me', {
    token: memberToken,
    body: { prefs: ['dashboardOnlyDue'] },
  });
  assert.equal(notObject.status, 400);
});

test('SYS-AUTH-10 / SR-154 / VT-159: the profile cannot be changed while impersonating (403)', async () => {
  const imp = await srv.request('POST', `/api/auth/impersonate/${memberId}`, { token: adminToken });
  assert.equal(imp.status, 200, 'admin starts a view-as session');

  // The impersonation token carries the TARGET's identity — a profile write would silently edit the
  // member's profile, so it is refused outright.
  const refused = await srv.request('PUT', '/api/auth/me', { token: imp.body.token, body: { locale: 'en' } });
  assert.equal(refused.status, 403);

  const me = await srv.request('GET', '/api/auth/me', { token: memberToken });
  assert.equal(me.body.locale, 'de', "the member's stored locale is untouched");
});

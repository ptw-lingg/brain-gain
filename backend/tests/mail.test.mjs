// Automated tests for outbound email (SYS-MAIL-01), traced to SR-097 / VT-133:
//   - POST /api/mail/send: validation (400), access control (member 403), 503 when SMTP unconfigured,
//     and — once configured — an actual delivery attempt (502 against an unreachable server).
//   - POST /api/mail/test: admin-only SMTP connection check to the caller's own address (401/403
//     guards, 503 unconfigured, 502 unreachable).
//   - The SMTP password is stored but never returned by the API (redacted; passwordSet flag), and a
//     blank password on a later save keeps the stored secret.
// Runs against a freshly-seeded, isolated backend (helpers/server.mjs); SMTP starts unconfigured.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let memberToken;

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `${email} can log in`);
  return res.body.token;
}

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  trainerToken = await loginToken('trainer@braingain.app', 'trainer123');
  memberToken = await loginToken('user@braingain.app', 'user123');
});

after(async () => { await srv?.stop(); });

test('SYS-MAIL-01 / VT-133: POST /api/mail/send returns 503 when SMTP is not configured', async () => {
  const res = await srv.request('POST', '/api/mail/send', {
    token: trainerToken,
    body: { to: ['x@test.local'], subject: 'Hi', text: 'Body' },
  });
  assert.equal(res.status, 503);
});

test('SYS-MAIL-01: POST /api/mail/send validates recipients, subject and text (400)', async () => {
  const noTo = await srv.request('POST', '/api/mail/send', {
    token: trainerToken,
    body: { to: [], subject: 's', text: 't' },
  });
  assert.equal(noTo.status, 400);
  const noBody = await srv.request('POST', '/api/mail/send', {
    token: trainerToken,
    body: { to: ['x@test.local'], subject: '', text: '' },
  });
  assert.equal(noBody.status, 400);
});

test('SYS-MAIL-01 / SYS-AC-01: only a trainer/admin may send mail (member is 403)', async () => {
  const res = await srv.request('POST', '/api/mail/send', {
    token: memberToken,
    body: { to: ['x@test.local'], subject: 's', text: 't' },
  });
  assert.equal(res.status, 403);
});

test('SYS-MAIL-01: the SMTP password is stored but never returned by the API', async () => {
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: {
      smtp: { enabled: false, host: 'smtp.test.local', port: 587, secure: false, username: 'u', password: 's3cret', fromName: 'BrainGain', fromAddress: 'no-reply@test.local' },
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.smtp.password, '', 'PUT response redacts the password');
  assert.equal(put.body.smtp.passwordSet, true);

  const get = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(get.body.smtp.password, '', 'GET redacts the password');
  assert.equal(get.body.smtp.passwordSet, true);
  assert.equal(get.body.smtp.host, 'smtp.test.local');

  // A blank password on a later save keeps the stored secret.
  const put2 = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { smtp: { enabled: false, host: 'smtp2.test.local', port: 587, secure: false, username: 'u', password: '', fromName: 'BrainGain', fromAddress: 'no-reply@test.local' } },
  });
  assert.equal(put2.body.smtp.passwordSet, true, 'blank password keeps the stored one');
});

test('SYS-MAIL-01 / VT-133: once configured, /send attempts delivery (502 on an unreachable server)', async () => {
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { smtp: { enabled: true, host: '127.0.0.1', port: 59999, secure: false, username: '', password: '', fromName: 'BrainGain', fromAddress: 'no-reply@test.local' } },
  });
  assert.equal(put.status, 200);
  const res = await srv.request('POST', '/api/mail/send', {
    token: trainerToken,
    body: { to: ['x@test.local'], subject: 'Hi', text: 'Body' },
  });
  assert.equal(res.status, 502, 'configured → tries to send → connection refused → 502');
});

// ───────────────────────── POST /api/mail/test — the admin's SMTP connection check ─────────────────────────

test('SYS-MAIL-01 / SYS-AC-01: POST /api/mail/test is admin-only (401 anonymous, 403 trainer and member)', async () => {
  const anon = await srv.request('POST', '/api/mail/test');
  assert.equal(anon.status, 401, 'no token → 401');
  const trainer = await srv.request('POST', '/api/mail/test', { token: trainerToken });
  assert.equal(trainer.status, 403, 'trainer → 403 (stricter than /send)');
  const member = await srv.request('POST', '/api/mail/test', { token: memberToken });
  assert.equal(member.status, 403, 'member → 403');
});

test('SYS-MAIL-01: POST /api/mail/test returns 503 while SMTP is disabled', async () => {
  const off = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { smtp: { enabled: false, host: '127.0.0.1', port: 59999, secure: false, username: '', password: '', fromName: 'BrainGain', fromAddress: 'no-reply@test.local' } },
  });
  assert.equal(off.status, 200);
  const res = await srv.request('POST', '/api/mail/test', { token: adminToken });
  assert.equal(res.status, 503, 'unconfigured → 503, no delivery attempt');
});

test('SYS-MAIL-01 / VT-133: once configured, /api/mail/test attempts delivery to the caller (502 on an unreachable server)', async () => {
  const on = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { smtp: { enabled: true, host: '127.0.0.1', port: 59999, secure: false, username: '', password: '', fromName: 'BrainGain', fromAddress: 'no-reply@test.local' } },
  });
  assert.equal(on.status, 200);
  const res = await srv.request('POST', '/api/mail/test', { token: adminToken });
  assert.equal(res.status, 502, 'configured → sends to the admin\'s own address → connection refused → 502');
});

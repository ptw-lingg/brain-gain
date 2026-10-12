// Automated API tests for administering pending activations (1.5.0):
//   SYS-USR-04   POST /api/users/:id/activation-link | activation-email | activate, and the user editor
//                (PUT with a password) enabling a pending account; GET /api/users exposes the link expiry
//                and hasPassword, never the token.
//   SYS-AUTH-09  links expire (410 { code: 'expired' }) and a new link revokes the previous one.
//   SYS-DATA-09  activationExpiresAt + the boot normalizer for links issued before they expired.
//
// Validation tests: VT-227 (admin hands out, emails or directly activates), VT-228 (expiry and
// revocation). Stakeholder reqs: SR-193, SR-194.
//
// Runs against a freshly-seeded, isolated backend (helpers/server.mjs). SMTP starts unconfigured; the
// email test points it at a tiny in-process SMTP stub that captures the message.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer } from './helpers/server.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

let srv;
let adminToken;
let memberToken;

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.token;
}

/** Import one pending account; returns { user (admin view), token, expiresAt }. */
async function importPending(name, email) {
  const imp = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { commit: true, rows: [{ name, email, roles: ['Lab Technician'] }] },
  });
  assert.equal(imp.status, 200, `import ${email}`);
  const row = imp.body.rows[0];
  const list = await srv.request('GET', '/api/users', { token: adminToken });
  const user = list.body.find((u) => u.email === email);
  assert.ok(user, `${email} is listed`);
  return { user, token: row.activationToken, expiresAt: row.activationExpiresAt };
}

const usersFile = () => join(srv.dataDir, 'users.json');
const readUsers = () => JSON.parse(readFileSync(usersFile(), 'utf-8'));
const rawAudit = () => readFileSync(join(srv.dataDir, 'audit.ndjson'), 'utf-8');
const auditEntries = () => rawAudit().trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  memberToken = await loginToken('user@braingain.app', 'user123');
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SR-194 / VT-228 — expiry and revocation ─────────────────────────

test('SYS-USR-04 / SYS-DATA-09 / VT-228 (SR-194): an imported link expires 14 days after it is issued; the admin list shows the expiry, never the token', async () => {
  const before = Date.now();
  const { user, token, expiresAt } = await importPending('Erin Expiry', 'erin.expiry@test.local');
  assert.ok(token, 'import returns the one-time token');
  const days = (Date.parse(expiresAt) - before) / DAY_MS;
  assert.ok(days > 13.99 && days < 14.01, `the link is valid for 14 days (got ${days.toFixed(3)})`);

  assert.equal(user.isDisabled, true, 'pending accounts are disabled');
  assert.equal(user.activationExpiresAt, expiresAt, 'the admin list carries the expiry');
  assert.equal(user.hasPassword, false, 'the admin list says whether a password exists');
  assert.equal(user.activationToken, undefined, 'the token never leaves in a user payload');
});

test('SYS-USR-04 / SYS-AUTH-09 / VT-228 (SR-194): a new link revokes the previous one, and an expired link is refused with 410 and activates nothing', async () => {
  const { user, token: first } = await importPending('Rory Revoke', 'rory.revoke@test.local');

  const issued = await srv.request('POST', `/api/users/${user.id}/activation-link`, { token: adminToken });
  assert.equal(issued.status, 200);
  const second = issued.body.activationToken;
  assert.ok(second && second !== first, 'every issue is a NEW token');
  assert.ok(Date.parse(issued.body.expiresAt) > Date.now() + 13 * DAY_MS, 'with a fresh 14-day window');

  assert.equal((await srv.request('GET', `/api/auth/activate/${first}`)).status, 404, 'the previous link is dead');
  const reuseFirst = await srv.request('POST', '/api/auth/activate', { body: { token: first, password: 'oldlink123' } });
  assert.equal(reuseFirst.status, 400, 'and cannot activate');
  assert.equal((await srv.request('GET', `/api/auth/activate/${second}`)).status, 200, 'the new link is live');

  // Age the live link past its expiry directly on disk (the store is read per request).
  const users = readUsers();
  users.find((u) => u.id === user.id).activationExpiresAt = new Date(Date.now() - 1000).toISOString();
  writeFileSync(usersFile(), JSON.stringify(users, null, 2));

  const peek = await srv.request('GET', `/api/auth/activate/${second}`);
  assert.equal(peek.status, 410, 'an expired link answers 410');
  assert.equal(peek.body.code, 'expired', 'with a machine-readable reason for the page');
  const use = await srv.request('POST', '/api/auth/activate', { body: { token: second, password: 'expired123' } });
  assert.equal(use.status, 410, 'an expired link cannot activate');
  const after = readUsers().find((u) => u.id === user.id);
  assert.equal(after.isDisabled, true, 'the account is still pending');
  assert.equal(after.passwordHash, undefined, 'no password was set');

  // The admin's way out: a new link works again.
  const renewed = await srv.request('POST', `/api/users/${user.id}/activation-link`, { token: adminToken });
  const ok = await srv.request('POST', '/api/auth/activate', { body: { token: renewed.body.activationToken, password: 'renewed123' } });
  assert.equal(ok.status, 200, 'a renewed link activates');
});

// ───────────────────────── SR-193 / VT-227 — the admin's controls ─────────────────────────

test('SYS-USR-04 / SYS-AC-02 / VT-227 (SR-193): the activation endpoints are admin-only and refuse accounts that are not pending', async () => {
  const { user } = await importPending('Gina Guard', 'gina.guard@test.local');
  for (const path of ['activation-link', 'activation-email', 'activate']) {
    const asMember = await srv.request('POST', `/api/users/${user.id}/${path}`, { token: memberToken, body: {} });
    assert.equal(asMember.status, 403, `${path}: a member is refused`);
    const anon = await srv.request('POST', `/api/users/${user.id}/${path}`, { body: {} });
    assert.equal(anon.status, 401, `${path}: authentication required`);
  }
  const unknown = await srv.request('POST', '/api/users/no-such-id/activation-link', { token: adminToken });
  assert.equal(unknown.status, 404, 'unknown user → 404');

  const list = await srv.request('GET', '/api/users', { token: adminToken });
  const admin = list.body.find((u) => u.email === 'admin@braingain.app');
  const link = await srv.request('POST', `/api/users/${admin.id}/activation-link`, { token: adminToken });
  assert.equal(link.status, 409, 'an active account gets no activation link');
  assert.equal(link.body.activationToken, undefined);
  const act = await srv.request('POST', `/api/users/${admin.id}/activate`, { token: adminToken, body: { password: 'whatever123' } });
  assert.equal(act.status, 409, 'an active account cannot be activated again');
});

test('SYS-USR-04 / SYS-MAIL-01 / VT-227 (SR-193): without SMTP the activation email is refused (503) and the current link keeps working', async () => {
  const { user, token } = await importPending('Nico NoMail', 'nico.nomail@test.local');
  const res = await srv.request('POST', `/api/users/${user.id}/activation-email`, { token: adminToken });
  assert.equal(res.status, 503, 'SMTP not configured → 503');
  assert.equal((await srv.request('GET', `/api/auth/activate/${token}`)).status, 200, 'nothing was rotated');
});

/** A minimal SMTP server that keeps each message's envelope recipients and DATA section. */
function startSmtpStub() {
  const messages = [];
  const recipients = [];
  const server = net.createServer((sock) => {
    let buf = '';
    let inData = false;
    sock.write('220 stub ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end === -1) return;
          messages.push(buf.slice(0, end));
          buf = buf.slice(end + 5);
          inData = false;
          sock.write('250 queued\r\n');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250 stub\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 go ahead\r\n'); }
        else if (line.toUpperCase().startsWith('RCPT TO:')) { recipients.push(line.slice(8).trim()); sock.write('250 ok\r\n'); }
        else if (cmd === 'QUIT') { sock.end('221 bye\r\n'); return; }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, messages, recipients, close: () => server.close() }));
  });
}

/** Undo quoted-printable soft breaks and =XX escapes so the link can be read from the raw message. */
const decodeQp = (s) =>
  s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

test('SYS-USR-04 / SYS-MAIL-01 / VT-227 (SR-193): with SMTP configured the activation email reaches the user with a new, working link', async () => {
  const smtp = await startSmtpStub();
  try {
    const saved = await srv.request('PUT', '/api/settings', {
      token: adminToken,
      body: { smtp: { enabled: true, host: '127.0.0.1', port: smtp.port, secure: false, username: '', password: '', fromName: 'BrainGain', fromAddress: 'noreply@test.local' } },
    });
    assert.equal(saved.status, 200, 'SMTP configured');

    const { user, token: old } = await importPending('Mia Mail', 'mia.mail@test.local');
    const res = await srv.request('POST', `/api/users/${user.id}/activation-email`, { token: adminToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.sentTo, 'mia.mail@test.local');
    assert.equal(res.body.activationToken, undefined, 'the token is not returned to the caller');

    assert.equal(smtp.messages.length, 1, 'one message was delivered');
    const body = decodeQp(smtp.messages[0]);
    // sendMail puts recipients in BCC, so the address is in the SMTP envelope, not the headers.
    assert.ok(smtp.recipients.some((r) => r.includes('mia.mail@test.local')), 'addressed to the pending user');
    const m = body.match(/\/activate\?token=([A-Za-z0-9_-]+)/);
    assert.ok(m, 'the message carries an activation link');
    assert.notEqual(m[1], old, 'emailing issues a new link');
    assert.equal((await srv.request('GET', `/api/auth/activate/${old}`)).status, 404, 'the previous link died');
    const act = await srv.request('POST', '/api/auth/activate', { body: { token: m[1], password: 'frommail123' } });
    assert.equal(act.status, 200, 'the emailed link activates the account');
  } finally {
    smtp.close();
    await srv.request('PUT', '/api/settings', { token: adminToken, body: { smtp: { enabled: false, host: '', port: 587, secure: false, username: '', password: '', fromName: '', fromAddress: '' } } });
  }
});

test('SYS-USR-04 / SYS-AUD-03 / VT-227 (SR-193): the admin activates a pending account directly with a password; the link dies and the activation is audited', async () => {
  const { user, token } = await importPending('Ada Admin-Activated', 'ada.activated@test.local');
  const short = await srv.request('POST', `/api/users/${user.id}/activate`, { token: adminToken, body: { password: 'short' } });
  assert.equal(short.status, 400, 'a password under 8 characters is refused');

  const res = await srv.request('POST', `/api/users/${user.id}/activate`, { token: adminToken, body: { password: 'adminset123' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.isDisabled, false, 'the account is enabled');
  assert.equal(res.body.activationExpiresAt, undefined, 'the link expiry is gone');
  assert.equal((await srv.request('GET', `/api/auth/activate/${token}`)).status, 404, 'the link no longer works');

  const login = await srv.request('POST', '/api/auth/login', { body: { email: 'ada.activated@test.local', password: 'adminset123' } });
  assert.equal(login.status, 200, 'the user signs in with the password the admin set');

  const entry = auditEntries().find((e) => e.action === 'activate' && e.entityId === user.id);
  assert.ok(entry, 'an activate entry is recorded');
  assert.equal(entry.actor?.email, 'admin@braingain.app', 'naming the administrator as the actor');
  assert.ok(!rawAudit().includes(token), 'the token never reaches the log');
});

test('SYS-USR-04 / VT-227 (SR-193): activating without a password needs an existing password or Microsoft sign-in', async () => {
  const { user } = await importPending('Sam SSO', 'sam.sso@test.local');
  const refused = await srv.request('POST', `/api/users/${user.id}/activate`, { token: adminToken, body: {} });
  assert.equal(refused.status, 400, 'no password and no SSO → refused');
  assert.equal(readUsers().find((u) => u.id === user.id).isDisabled, true, 'still pending');

  const sso = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { entra: { enabled: true, tenantId: '00000000-0000-0000-0000-000000000001', clientId: '00000000-0000-0000-0000-000000000002', allowedDomains: ['test.local'] } },
  });
  assert.equal(sso.status, 200, 'Microsoft sign-in configured');
  try {
    const ok = await srv.request('POST', `/api/users/${user.id}/activate`, { token: adminToken, body: {} });
    assert.equal(ok.status, 200, 'with SSO the account is enabled without a password');
    assert.equal(ok.body.isDisabled, false);
    assert.equal(ok.body.hasPassword, false, 'and still has no local password (signs in with Microsoft)');
  } finally {
    await srv.request('PUT', '/api/settings', { token: adminToken, body: { entra: { enabled: false, tenantId: '', clientId: '', allowedDomains: [] } } });
  }
});

test('SYS-USR-01 / SYS-USR-04 / VT-227 (SR-193): setting a password for a pending account in the user editor activates it', async () => {
  const { user, token } = await importPending('Martha Editor', 'martha.editor@test.local');
  const res = await srv.request('PUT', `/api/users/${user.id}`, { token: adminToken, body: { password: 'editorset123' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.isDisabled, false, 'saving a password enabled the account');
  assert.equal((await srv.request('GET', `/api/auth/activate/${token}`)).status, 404, 'its link is spent');
  const login = await srv.request('POST', '/api/auth/login', { body: { email: 'martha.editor@test.local', password: 'editorset123' } });
  assert.equal(login.status, 200, 'the user can sign in');
  assert.ok(auditEntries().some((e) => e.action === 'activate' && e.entityId === user.id), 'the activation is audited');

  // An edit WITHOUT a password leaves a pending account pending.
  const { user: other } = await importPending('Paul Pending', 'paul.pending@test.local');
  const rename = await srv.request('PUT', `/api/users/${other.id}`, { token: adminToken, body: { name: 'Paul Still Pending' } });
  assert.equal(rename.body.isDisabled, true, 'a plain edit does not activate');
});

// ───────────────────────── SYS-DATA-09 / VT-228 — the boot normalizer ─────────────────────────

test('SYS-DATA-09 / VT-228 (SR-194): at boot, links issued before expiry existed get 14 days, and a disabled account that holds a password loses its dead link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'braingain-activation-'));
  let first;
  let second;
  try {
    first = await startTestServer({ env: { DATA_DIR: dir } }); // seeds the directory
    await first.stop();
    const users = JSON.parse(readFileSync(join(dir, 'users.json'), 'utf-8'));
    const admin = users.find((u) => u.email === 'admin@braingain.app');
    const base = { roleIds: [], orgUnitId: admin.orgUnitId, isAdmin: false, isTrainer: false, isDisabled: true, createdAt: new Date().toISOString() };
    // 1.4.x shapes: a pending link without expiry, and an account an admin gave a password (still disabled).
    users.push({ ...base, id: 'legacy-pending', email: 'legacy.pending@test.local', name: 'Legacy Pending', activationToken: 'legacy-token-a' });
    users.push({ ...base, id: 'legacy-stuck', email: 'legacy.stuck@test.local', name: 'Legacy Stuck', activationToken: 'legacy-token-b', passwordHash: admin.passwordHash });
    writeFileSync(join(dir, 'users.json'), JSON.stringify(users, null, 2));

    const bootAt = Date.now();
    second = await startTestServer({ env: { DATA_DIR: dir } });
    const after = JSON.parse(readFileSync(join(dir, 'users.json'), 'utf-8'));
    const pending = after.find((u) => u.id === 'legacy-pending');
    const days = (Date.parse(pending.activationExpiresAt) - bootAt) / DAY_MS;
    assert.ok(days > 13.9 && days < 14.1, `a legacy link gets the 14-day window from the upgrade (got ${days.toFixed(3)})`);
    assert.equal((await second.request('GET', '/api/auth/activate/legacy-token-a')).status, 200, 'and keeps working');

    const stuck = after.find((u) => u.id === 'legacy-stuck');
    assert.equal(stuck.activationToken, undefined, 'the dead link of an account with a password is dropped');
    assert.equal(stuck.isDisabled, true, 'the account stays disabled until an admin activates it');

    // The admin's way out for such an account: activate without a password — it keeps the one it has.
    const tok = (await second.request('POST', '/api/auth/login', { body: { email: 'admin@braingain.app', password: 'admin123' } })).body.token;
    const act = await second.request('POST', '/api/users/legacy-stuck/activate', { token: tok, body: {} });
    assert.equal(act.status, 200, 'activated, keeping its existing password');
    const login = await second.request('POST', '/api/auth/login', { body: { email: 'legacy.stuck@test.local', password: 'admin123' } });
    assert.equal(login.status, 200, 'the account signs in with the password it already had');
  } finally {
    await second?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

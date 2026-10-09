// Automated API tests for the audit trail (SYS area AUD).
//
// Covers the system requirements / validation tests:
//   SYS-AUD-01 / VT-168  append-only NDJSON store; torn lines skipped on read
//   SYS-AUD-02 / VT-168  admin mutations audited with redacted field diffs (password, SMTP password,
//                        quiz answer key never in plaintext)
//   SYS-AUD-03 / VT-168  auth events: login, actor-less failed login, activation, impersonation
//   SYS-AUD-04 / VT-168  training completions audited on pass only
//   SYS-AUD-07 / VT-169  backups carry data/audit.ndjson OUTSIDE manifest.files; a restore never
//                        touches the local log and is itself appended as an entry
//   SYS-AUD-05 / VT-170  GET /api/audit — admin-only, filters, offset/limit paging, { total, entries }
//   SYS-AUD-06 / VT-170  GET /api/audit/export.csv — attachment, header row, quoting, formula guard
//
// The e2e counterpart (frontend/e2e/audit-trail.spec.ts, SYS-AUD-08 / VT-171) covers the admin page:
// listing, filtering, expanding diffs, CSV download and the non-admin redirect.
//
// The temp DATA_DIR exposed by the harness lets us read audit.ndjson raw — the redaction assertions
// run against the bytes on disk, not the API's view of them.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let memberToken;
let memberId;

async function login(email, password) {
  const r = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `${email} can log in`);
  return r.body;
}

const rawLog = () => readFileSync(join(srv.dataDir, 'audit.ndjson'), 'utf-8');
const listAudit = (qs = '', token = adminToken) => srv.request('GET', `/api/audit${qs ? `?${qs}` : ''}`, { token });

/** GET returning raw bytes + headers (downloads). */
async function getBytes(path, token) {
  const res = await fetch(`${srv.baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

before(async () => {
  srv = await startTestServer();
  adminToken = (await login('admin@braingain.app', 'admin123')).token;
  const member = await login('user@braingain.app', 'user123');
  memberToken = member.token;
  memberId = member.user.id;
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-AUD-02 — mutations with redacted diffs ─────────────────────────

test('SYS-AUD-02 / SR-159 / VT-168: creating, updating and deleting a user writes entries with field diffs and a masked password', async () => {
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Audit Subject', email: 'audit-subject@example.com', password: 'topsecret-pass-1' },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;

  const roles = (await srv.request('GET', '/api/roles', { token: adminToken })).body;
  const role = roles.find((r) => r.name === 'Lab Technician');
  assert.ok(role, 'the seeded Lab Technician role exists');

  const updated = await srv.request('PUT', `/api/users/${id}`, {
    token: adminToken,
    body: { name: 'Audit Subject Renamed', password: 'topsecret-pass-2', roleIds: [role.id, 'no-such-role'] },
  });
  assert.equal(updated.status, 200);

  const deleted = await srv.request('DELETE', `/api/users/${id}`);
  assert.equal(deleted.status, 401, 'no token → the delete is refused and NOT audited');
  assert.equal((await srv.request('DELETE', `/api/users/${id}`, { token: adminToken })).status, 204);

  const { body } = await listAudit('entityType=user&q=audit-subject@example.com');
  const actions = body.entries.map((e) => e.action);
  assert.ok(actions.includes('create'), 'create audited');
  assert.ok(actions.includes('update'), 'update audited');
  assert.ok(actions.includes('delete'), 'delete audited');

  const upd = body.entries.find((e) => e.action === 'update');
  assert.equal(upd.actor.email, 'admin@braingain.app', 'the acting admin is recorded');
  const nameChange = upd.changes.find((c) => c.field === 'name');
  assert.deepEqual({ from: nameChange.from, to: nameChange.to }, { from: 'Audit Subject', to: 'Audit Subject Renamed' });
  const pwChange = upd.changes.find((c) => c.field === 'password');
  assert.deepEqual({ from: pwChange.from, to: pwChange.to }, { from: '***', to: '***' }, 'the password change is recorded masked');
  const roleChange = upd.changes.find((c) => c.field === 'roleIds');
  assert.deepEqual(
    { from: roleChange.from, to: roleChange.to },
    { from: [], to: [`Lab Technician (${role.id})`, 'no-such-role'] },
    'assigned roles are logged as "Name (id)"; an unresolvable id stays bare',
  );

  const raw = rawLog();
  assert.ok(!raw.includes('topsecret-pass-1') && !raw.includes('topsecret-pass-2'), 'no plaintext password on disk');
  assert.ok(!raw.includes('passwordHash'), 'no password hash field on disk');
});

test('SYS-AUD-02 / SR-159 / VT-168: a committed import update logs the replaced roles as "Name (id)"', async () => {
  const roles = (await srv.request('GET', '/api/roles', { token: adminToken })).body;
  const role = roles.find((r) => r.name === 'Lab Technician');
  const created = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Import Subject', email: 'import-subject@example.com', password: 'topsecret-pass-3', roleIds: [role.id] },
  });
  assert.equal(created.status, 201);

  const imported = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { commit: true, rows: [{ name: 'Import Subject', email: 'import-subject@example.com', roles: [] }] },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.summary.update, 1);

  const { body } = await listAudit('entityType=user&action=update&q=import-subject@example.com');
  const upd = body.entries.find((e) => e.details === 'imported');
  assert.ok(upd, 'the import update is audited');
  const roleChange = upd.changes.find((c) => c.field === 'roleIds');
  assert.deepEqual({ from: roleChange.from, to: roleChange.to }, { from: [`Lab Technician (${role.id})`], to: [] });
});

test('SYS-AUD-02 / SR-159 / VT-168: a settings save diffs dot-path fields and never logs the SMTP password; a training edit masks the question key', async () => {
  const saved = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: {
      smtp: { enabled: false, host: 'mail.example.com', port: 587, secure: false, username: '', password: 'supersecret-smtp', fromName: '', fromAddress: '' },
    },
  });
  assert.equal(saved.status, 200);

  const { body } = await listAudit('entityType=settings');
  const entry = body.entries[0];
  const host = entry.changes.find((c) => c.field === 'smtp.host');
  assert.equal(host.to, 'mail.example.com', 'nested settings diff as dot-paths');
  const pw = entry.changes.find((c) => c.field === 'smtp.password');
  assert.deepEqual({ from: pw.from, to: pw.to }, { from: '***', to: '***' }, 'the SMTP password change is masked');
  assert.ok(!rawLog().includes('supersecret-smtp'), 'no plaintext SMTP password on disk');

  // Edit a training's quiz — the content is STAGED as a draft, and the draft field (which carries
  // a full questions snapshot including the answer key) is masked wholesale in the diff.
  const trainings = await srv.request('GET', '/api/trainings', { token: adminToken });
  const t = trainings.body[0];
  const questions = t.questions.map((q, i) => (i === 0 ? { ...q, text: { ...q.text, en: 'Audit-changed question' } } : q));
  const put = await srv.request('PUT', `/api/trainings/${t.id}`, { token: adminToken, body: { questions } });
  assert.equal(put.status, 200);

  const audit = await listAudit('entityType=training&action=update');
  const qChange = audit.body.entries[0].changes.find((c) => c.field === 'draft');
  assert.deepEqual({ from: qChange.from, to: qChange.to }, { from: '***', to: '***' }, 'the staged quiz change is recorded masked');
  assert.ok(!rawLog().includes('correctIndices'), 'no answer key on disk');
});

// ───────────────────────── SYS-AUD-03 — auth events ─────────────────────────

test('SYS-AUD-03 / SR-159 / VT-168: successful and failed sign-ins, activation and impersonation are recorded', async () => {
  // Failed sign-in: actor-less, only the attempted email.
  const failed = await srv.request('POST', '/api/auth/login', { body: { email: 'user@braingain.app', password: 'wrong' } });
  assert.equal(failed.status, 401);

  // Activation: import a pending user, then activate with their one-time token.
  const imported = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { rows: [{ name: 'Pending Person', email: 'pending@example.com', roles: '' }], commit: true },
  });
  assert.equal(imported.status, 200);
  const activationToken = imported.body.rows[0].activationToken;
  const activated = await srv.request('POST', '/api/auth/activate', { body: { token: activationToken, password: 'freshpass1' } });
  assert.equal(activated.status, 200);

  // Impersonation: admin views as the member.
  const imp = await srv.request('POST', `/api/auth/impersonate/${memberId}`, { token: adminToken });
  assert.equal(imp.status, 200);

  const { body } = await listAudit('entityType=auth');
  const loginEntry = body.entries.find((e) => e.action === 'login' && e.entityName === 'user@braingain.app');
  assert.equal(loginEntry.actor.email, 'user@braingain.app', 'a successful sign-in names its own user as actor');

  const failedEntry = body.entries.find((e) => e.action === 'login-failed');
  assert.equal(failedEntry.actor, null, 'a failed sign-in asserts no identity');
  assert.equal(failedEntry.entityName, 'user@braingain.app', 'only the attempted email is recorded');
  assert.equal(failedEntry.details, 'invalid credentials or disabled account', 'the generic reason avoids enumeration');

  const activateEntry = body.entries.find((e) => e.action === 'activate');
  assert.equal(activateEntry.entityName, 'pending@example.com');

  const impEntries = await listAudit('action=impersonate');
  const impEntry = impEntries.body.entries[0];
  assert.equal(impEntry.actor.email, 'admin@braingain.app', 'the impersonating admin is the actor');
  assert.equal(impEntry.entityName, 'user@braingain.app', 'the impersonated user is the entity');

  // The committed import row was audited too (as a user create).
  const importCreate = await listAudit('entityType=user&q=pending@example.com');
  assert.ok(importCreate.body.entries.some((e) => e.action === 'create' && e.details === 'imported'));
  assert.ok(!rawLog().includes(activationToken), 'the one-time activation token never reaches the log');
});

// ───────────────────────── SYS-AUD-04 — completions on pass only ─────────────────────────

test('SYS-AUD-04 / SR-159 / VT-168: a passed grading writes a training-completed entry and a failed attempt writes none', async () => {
  // The admin view carries the answer key — grade once perfectly, once with everything wrong.
  const trainings = await srv.request('GET', '/api/trainings', { token: adminToken });
  const t = trainings.body.find((x) => x.questions.length > 0);
  const rightAnswers = t.questions.map((q) => q.correctIndices);
  const wrongAnswers = t.questions.map(() => []);

  const passed = await srv.request('POST', '/api/sessions/grade', { token: memberToken, body: { trainingId: t.id, answers: rightAnswers, reauth: { password: 'user123' } } });
  assert.equal(passed.status, 200);
  assert.equal(passed.body.passed, true);

  const afterPass = await listAudit('action=training-completed');
  assert.equal(afterPass.body.total, 1, 'the pass is audited');
  const entry = afterPass.body.entries[0];
  assert.equal(entry.actor.email, 'user@braingain.app', 'the learner is the actor');
  assert.equal(entry.entityId, t.id);
  assert.match(entry.details, /^score \d+% · signed: password$/, 'score AND the completion-signature method are on record');

  const failedAttempt = await srv.request('POST', '/api/sessions/grade', { token: memberToken, body: { trainingId: t.id, answers: wrongAnswers, reauth: { password: 'user123' } } });
  assert.equal(failedAttempt.status, 200);
  assert.equal(failedAttempt.body.passed, false);

  const afterFail = await listAudit('action=training-completed');
  assert.equal(afterFail.body.total, 1, 'a failed attempt writes no entry');
});

// ───────────────────────── SYS-AUD-01 — torn lines ─────────────────────────

test('SYS-AUD-01 / SR-159 / VT-168: a torn last line is skipped on read', async () => {
  const before = (await listAudit()).body.total;
  appendFileSync(join(srv.dataDir, 'audit.ndjson'), '{"id":"torn-entry","timestamp":"2026-'); // crash mid-append
  const after = await listAudit();
  assert.equal(after.status, 200, 'the torn line does not break the API');
  assert.equal(after.body.total, before, 'every intact entry is still there; only the torn line is skipped');
  // The next append lands on its own line and parses again.
  await srv.request('POST', '/api/roles', { token: adminToken, body: { name: 'After Torn Line' } });
  assert.equal((await listAudit()).body.total, before + 1, 'appends keep working after a torn line');
});

// ───────────────────────── SYS-AUD-07 — carried in backups, survives restore ─────────────────────────

test('SYS-AUD-07 / SR-161 / VT-169: a backup archive carries data/audit.ndjson without listing it in manifest.files', async () => {
  const created = await srv.request('POST', '/api/backups', { token: adminToken });
  assert.equal(created.status, 201);
  const dl = await getBytes(`/api/backups/${created.body.id}/download`, adminToken);
  assert.equal(dl.status, 200);

  const zip = await JSZip.loadAsync(dl.bytes);
  assert.ok(zip.file('data/audit.ndjson'), 'the archive carries the audit log as evidence');
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.ok(!manifest.files.some((f) => f.includes('audit')), 'manifest.files never lists the audit log (restore swaps only files)');
  assert.equal(manifest.audit, 'audit.ndjson', 'the manifest names the copy in its own field instead');

  const archived = await zip.file('data/audit.ndjson').async('string');
  assert.ok(archived.includes('"action":"login"'), 'the archived copy holds real entries');
});

test('SYS-AUD-07 / SR-161 / VT-169: restoring a backup leaves the local audit log intact and appends the backup-restore entry', async () => {
  const backup = await srv.request('POST', '/api/backups', { token: adminToken });
  assert.equal(backup.status, 201);

  // History written AFTER the backup — a restore that imported the archived copy would lose this.
  const role = await srv.request('POST', '/api/roles', { token: adminToken, body: { name: 'Post-Backup Role' } });
  assert.equal(role.status, 201);
  const beforeRestore = (await listAudit()).body.total;

  const restored = await srv.request('POST', `/api/backups/${backup.body.id}/restore`, { token: adminToken });
  assert.equal(restored.status, 200);

  const after = await listAudit();
  // beforeRestore entries + backup-create (for the restore's own POST above happened before count) —
  // the restore appends exactly one backup-restore entry on top of everything already recorded.
  assert.equal(after.body.total, beforeRestore + 1, 'nothing was erased; exactly the restore entry was added');
  assert.ok(
    after.body.entries.some((e) => e.action === 'create' && e.entityName === 'Post-Backup Role'),
    'entries written after the backup survived the restore',
  );
  const restoreEntry = after.body.entries[0];
  assert.equal(restoreEntry.action, 'backup-restore', 'the restore itself is the newest entry');
  assert.equal(restoreEntry.actor.email, 'admin@braingain.app');
  assert.match(restoreEntry.details, /^safety backup /, 'the pre-restore safety snapshot is referenced');
});

// ───────────────────────── SYS-AUD-05 — read API ─────────────────────────

test('SYS-AUD-05 / SR-160 / VT-170: GET /api/audit requires an administrator, filters and pages with total', async () => {
  assert.equal((await srv.request('GET', '/api/audit')).status, 401, 'anonymous is rejected');
  assert.equal((await srv.request('GET', '/api/audit', { token: memberToken })).status, 403, 'a member is rejected');

  const all = await listAudit();
  assert.equal(all.status, 200);
  assert.ok(all.body.total > 5, 'the earlier tests produced history');
  const stamps = all.body.entries.map((e) => e.timestamp);
  assert.deepEqual([...stamps].sort().reverse(), stamps, 'newest first');

  // Filters: by action, by entity type, by free text — each strictly narrower than the whole log.
  const byAction = await listAudit('action=login-failed');
  assert.ok(byAction.body.total >= 1 && byAction.body.entries.every((e) => e.action === 'login-failed'));
  const byType = await listAudit('entityType=role');
  assert.ok(byType.body.total >= 1 && byType.body.entries.every((e) => e.entityType === 'role'));
  const byText = await listAudit('q=post-backup');
  assert.ok(byText.body.total >= 1 && byText.body.entries.every((e) => e.entityName.toLowerCase().includes('post-backup')));

  // Date range: everything happened today, so today's bounds keep the total and a past window is empty.
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await listAudit(`from=${today}&to=${today}`)).body.total, all.body.total);
  assert.equal((await listAudit('from=2000-01-01&to=2000-12-31')).body.total, 0);

  // Paging: offset/limit slice the same filtered list; total stays the filtered count.
  const page1 = await listAudit('limit=2&offset=0');
  const page2 = await listAudit('limit=2&offset=2');
  assert.equal(page1.body.entries.length, 2);
  assert.equal(page1.body.total, all.body.total);
  assert.deepEqual(page2.body.entries.map((e) => e.id), all.body.entries.slice(2, 4).map((e) => e.id));
});

// ───────────────────────── SYS-AUD-06 — CSV export ─────────────────────────

test('SYS-AUD-06 / SR-160 / VT-170: the CSV export is an attachment with header row, filtered rows and quoted/guarded cells', async () => {
  // A role whose name needs quoting AND the formula guard.
  const spicy = await srv.request('POST', '/api/roles', { token: adminToken, body: { name: '=SUM(A1),"x"' } });
  assert.equal(spicy.status, 201);

  assert.equal((await getBytes('/api/audit/export.csv', undefined)).status, 401, 'export is admin-only too');

  const res = await getBytes('/api/audit/export.csv?entityType=role&action=create', adminToken);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="braingain-audit-.*\.csv"/);

  const text = res.bytes.toString('utf-8');
  assert.equal(text.charCodeAt(0), 0xfeff, 'UTF-8 BOM for Excel');
  const lines = text.slice(1).split('\r\n').filter(Boolean);
  assert.equal(lines[0], 'timestamp,actorEmail,impersonatorEmail,action,entityType,entityId,entityName,changes,details', 'header row');

  const filtered = await listAudit('entityType=role&action=create');
  assert.equal(lines.length - 1, filtered.body.total, 'one row per filtered entry');

  const spicyRow = lines.find((l) => l.includes('SUM(A1)'));
  assert.ok(spicyRow.includes('"\'=SUM(A1),""x"""'), 'the cell is formula-guarded and RFC-4180 quoted');
});

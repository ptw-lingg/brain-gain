// Automated API tests for the organizational-unit feature (SYS-ORG):
//   SYS-ORG-01  org-unit CRUD, admin-only (members may read; mutations → 403)
//   SYS-ORG-02  hierarchy integrity: re-parenting that would create a cycle → 400;
//               deleting a unit that still has sub-units or members → 409
//   SYS-ORG-03  membership: users carry orgUnitId; the migration seeds a root (company) unit and
//               backfills every user; the root is named from Settings.companyName
//   SYS-ORG-04  user import supports an Org Unit column (matched by name; unknown → error;
//               missing on a create row → defaults to the root unit)
//   SYS-ORG-05  head oversight: GET /org-units/my-team returns everyone in the head's unit and
//               sub-units with their training due status; non-heads get an empty team
//   SYS-ORG-06  company name is admin-editable and renames the root unit; non-admins → 403
//
// Runs against a freshly-seeded, isolated backend (helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app / admin123    (admin; migration makes them head of the root unit)
//   trainer@braingain.app / trainer123 (trainer; owns seeded trainings)
//   user@braingain.app  / user123     (member, holds the "Lab Technician" role → 2 trainings)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/server.mjs';

let srv;
let adminToken;
let memberToken;
let rootId;

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.token;
}

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  memberToken = await loginToken('user@braingain.app', 'user123');
  const units = await srv.request('GET', '/api/org-units', { token: adminToken });
  assert.equal(units.status, 200);
  rootId = units.body.find((o) => o.parentId === null)?.id;
  assert.ok(rootId, 'a root org unit exists after migration');
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-ORG-03 — migration / membership invariant ─────────────────────────

test('SYS-ORG-03 / VT-125 (SR-124): migration seeds a single root unit named from companyName and backfills users', async () => {
  const units = await srv.request('GET', '/api/org-units', { token: adminToken });
  assert.equal(units.status, 200);
  const roots = units.body.filter((o) => o.parentId === null);
  assert.equal(roots.length, 1, 'exactly one root unit');
  assert.equal(roots[0].name, 'PTW Dosimetry', 'root unit is named from the default companyName');

  const settings = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(settings.body.companyName, 'PTW Dosimetry', 'companyName default present');

  const usersRes = await srv.request('GET', '/api/users', { token: adminToken });
  assert.equal(usersRes.status, 200);
  for (const u of usersRes.body) {
    assert.ok(u.orgUnitId, `user ${u.email} was backfilled with an orgUnitId`);
  }
});

test('SYS-ORG-03 / VT-126 (SR-125): the migration makes the first admin the head of the root unit', async () => {
  const me = await srv.request('GET', '/api/auth/me', { token: adminToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.isHead, true, 'admin heads the root unit → isHead true');
});

// ───────────────────────── SYS-ORG-01 — CRUD + admin-only ─────────────────────────

test('SYS-ORG-01 / VT-125 (SR-124): admin creates, updates and deletes an org unit; member may read only', async () => {
  const created = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'Engineering', parentId: rootId, headUserId: '' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Engineering');
  assert.equal(created.body.parentId, rootId);
  const id = created.body.id;

  const updated = await srv.request('PUT', `/api/org-units/${id}`, {
    token: adminToken,
    body: { name: 'Engineering & Ops' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Engineering & Ops');

  // Member may read the list…
  const memberList = await srv.request('GET', '/api/org-units', { token: memberToken });
  assert.equal(memberList.status, 200, 'GET /org-units is readable by any authenticated user');
  // …but cannot mutate.
  const memberCreate = await srv.request('POST', '/api/org-units', {
    token: memberToken,
    body: { name: 'Nope', parentId: rootId },
  });
  assert.equal(memberCreate.status, 403, 'POST requires admin');
  const memberDelete = await srv.request('DELETE', `/api/org-units/${id}`, { token: memberToken });
  assert.equal(memberDelete.status, 403, 'DELETE requires admin');

  const del = await srv.request('DELETE', `/api/org-units/${id}`, { token: adminToken });
  assert.equal(del.status, 204, 'admin deletes an empty unit');
});

test('SYS-ORG-01: /api/org-units requires authentication → 401 without a token', async () => {
  const res = await srv.request('GET', '/api/org-units');
  assert.equal(res.status, 401);
});

// ───────────────────────── SYS-ORG-02 — hierarchy integrity ─────────────────────────

test('SYS-ORG-02 / VT-125 (SR-124): re-parenting that would create a cycle is rejected → 400', async () => {
  const a = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'Cycle A', parentId: rootId },
  });
  const b = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'Cycle B', parentId: a.body.id },
  });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  // Make A a child of its own descendant B → cycle.
  const cyclic = await srv.request('PUT', `/api/org-units/${a.body.id}`, {
    token: adminToken,
    body: { parentId: b.body.id },
  });
  assert.equal(cyclic.status, 400, 'cycle rejected');

  // A unit cannot be its own parent either.
  const self = await srv.request('PUT', `/api/org-units/${a.body.id}`, {
    token: adminToken,
    body: { parentId: a.body.id },
  });
  assert.equal(self.status, 400, 'self-parent rejected');

  // cleanup (child first)
  await srv.request('DELETE', `/api/org-units/${b.body.id}`, { token: adminToken });
  await srv.request('DELETE', `/api/org-units/${a.body.id}`, { token: adminToken });
});

test('SYS-ORG-02 / VT-125 (SR-124): deleting a unit with sub-units or members is blocked → 409', async () => {
  const parent = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'Has Children', parentId: rootId },
  });
  const child = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'A Child', parentId: parent.body.id },
  });

  const blockedByChild = await srv.request('DELETE', `/api/org-units/${parent.body.id}`, { token: adminToken });
  assert.equal(blockedByChild.status, 409, 'cannot delete a unit that has sub-units');

  // Put a member in the child, then deleting the child is blocked too.
  const u = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Unit Member', email: 'unit.member@test.local', password: 'secret123', orgUnitId: child.body.id },
  });
  assert.equal(u.status, 201);
  assert.equal(u.body.orgUnitId, child.body.id, 'user assigned to the child unit');

  const blockedByMember = await srv.request('DELETE', `/api/org-units/${child.body.id}`, { token: adminToken });
  assert.equal(blockedByMember.status, 409, 'cannot delete a unit that still has members');

  // Reassign the member to root, then both deletes succeed (child first).
  await srv.request('PUT', `/api/users/${u.body.id}`, { token: adminToken, body: { orgUnitId: rootId } });
  assert.equal((await srv.request('DELETE', `/api/org-units/${child.body.id}`, { token: adminToken })).status, 204);
  assert.equal((await srv.request('DELETE', `/api/org-units/${parent.body.id}`, { token: adminToken })).status, 204);
  await srv.request('DELETE', `/api/users/${u.body.id}`, { token: adminToken });
});

// ───────────────────────── user create/update with orgUnitId ─────────────────────────

test('SYS-ORG-03 / VT-125 (SR-124): POST /users validates orgUnitId (invalid → 400; omitted → defaults to root)', async () => {
  const bad = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Bad Unit', email: 'bad.unit@test.local', password: 'secret123', orgUnitId: 'nope' },
  });
  assert.equal(bad.status, 400, 'unknown orgUnitId rejected');

  const omitted = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Default Unit', email: 'default.unit@test.local', password: 'secret123' },
  });
  assert.equal(omitted.status, 201);
  assert.equal(omitted.body.orgUnitId, rootId, 'omitted orgUnitId defaults to the root unit');
});

// ───────────────────────── SYS-ORG-07 — bulk add members ─────────────────────────

test('SYS-ORG-07 / VT-130 (SR-124): admin moves several users into a unit at once', async () => {
  const dest = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'Bulk Dest', parentId: rootId },
  });
  assert.equal(dest.status, 201);

  // Two fresh users (land in root by default).
  const mk = (n) => srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: `Bulk ${n}`, email: `bulk.${n}@test.local`, password: 'secret123' },
  });
  const a = await mk('a');
  const b = await mk('b');
  assert.equal(a.body.orgUnitId, rootId);

  // Bulk-move both into the destination unit; an unknown id is ignored.
  const moved = await srv.request('POST', `/api/org-units/${dest.body.id}/members`, {
    token: adminToken,
    body: { userIds: [a.body.id, b.body.id, 'ghost-id'] },
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.moved, 2, 'two real users moved, unknown id ignored');

  const usersRes = await srv.request('GET', '/api/users', { token: adminToken });
  const inDest = usersRes.body.filter((u) => u.orgUnitId === dest.body.id).map((u) => u.email);
  assert.ok(inDest.includes('bulk.a@test.local') && inDest.includes('bulk.b@test.local'), 'both users now in the unit');

  // Idempotent: re-adding the same users moves nobody.
  const again = await srv.request('POST', `/api/org-units/${dest.body.id}/members`, {
    token: adminToken,
    body: { userIds: [a.body.id, b.body.id] },
  });
  assert.equal(again.body.moved, 0, 'already-members are not moved again');

  // Unknown unit → 404; bad body → 400; non-admin → 403.
  assert.equal(
    (await srv.request('POST', '/api/org-units/nope/members', { token: adminToken, body: { userIds: [a.body.id] } })).status,
    404,
  );
  assert.equal(
    (await srv.request('POST', `/api/org-units/${dest.body.id}/members`, { token: adminToken, body: { userIds: 'x' } })).status,
    400,
  );
  assert.equal(
    (await srv.request('POST', `/api/org-units/${dest.body.id}/members`, { token: memberToken, body: { userIds: [a.body.id] } })).status,
    403,
  );
});

// ───────────────────────── SYS-ORG-04 — import with an Org Unit column ─────────────────────────

test('SYS-ORG-04 / VT-128 (SR-127): import matches Org Unit by name; unknown → error; missing on create → root', async () => {
  const dept = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'Imports Dept', parentId: rootId },
  });
  assert.equal(dept.status, 201);

  const preview = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: {
      commit: false,
      rows: [
        { name: 'Imp One', email: 'imp.one@test.local', roles: '', orgUnit: 'Imports Dept' }, // create, known unit
        { name: 'Imp Two', email: 'imp.two@test.local', roles: '', orgUnit: 'Ghost Unit' }, // unknown unit → error
        { name: 'Imp Three', email: 'imp.three@test.local', roles: '', orgUnit: '' }, // missing → defaults to root
      ],
    },
  });
  assert.equal(preview.status, 200);
  const [r1, r2, r3] = preview.body.rows;
  assert.equal(r1.action, 'create');
  assert.equal(r1.matchedOrgUnitId, dept.body.id, 'known unit resolved');
  assert.equal(r2.action, 'error');
  assert.ok(r2.errors.some((e) => /Unknown org unit/i.test(e)), 'unknown unit flagged');
  assert.equal(r3.action, 'create', 'missing org unit still creates (defaults to root)');

  // Commit only the valid row and confirm the new user lands in the right unit.
  const commit = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { commit: true, rows: [{ name: 'Imp One', email: 'imp.one@test.local', roles: '', orgUnit: 'Imports Dept' }] },
  });
  assert.equal(commit.status, 200);
  assert.equal(commit.body.summary.create, 1);
  const usersRes = await srv.request('GET', '/api/users', { token: adminToken });
  const created = usersRes.body.find((u) => u.email === 'imp.one@test.local');
  assert.ok(created, 'imported user exists');
  assert.equal(created.orgUnitId, dept.body.id, 'imported user assigned to the matched unit');
});

// ───────────────────────── SYS-ORG-05 — head oversight (my-team) ─────────────────────────

test('SYS-ORG-05 / VT-126 / VT-127 (SR-125, SR-126): a head sees everyone in their unit + sub-units with due status; non-heads get nothing', async () => {
  // A non-head member sees an empty team.
  const before = await srv.request('GET', '/api/org-units/my-team', { token: memberToken });
  assert.equal(before.status, 200);
  assert.equal(before.body.members.length, 0, 'a non-head has an empty team');

  // Build a small subtree: QA → QA Sub, headed by the member.
  const memberId = (await srv.request('GET', '/api/auth/me', { token: memberToken })).body.id;
  const qa = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'QA', parentId: rootId, headUserId: memberId },
  });
  const qaSub = await srv.request('POST', '/api/org-units', {
    token: adminToken,
    body: { name: 'QA Sub', parentId: qa.body.id },
  });

  // A role that requires a real seeded training, assigned to a report placed in the sub-unit.
  const trainings = await srv.request('GET', '/api/trainings', { token: adminToken });
  const trainingId = trainings.body[0].id;
  const role = await srv.request('POST', '/api/roles', {
    token: adminToken,
    body: { name: 'QA Role', description: '', trainingIds: [trainingId] },
  });
  const report = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: {
      name: 'QA Report',
      email: 'qa.report@test.local',
      password: 'secret123',
      orgUnitId: qaSub.body.id,
      roleIds: [role.body.id],
    },
  });
  assert.equal(report.status, 201);

  // The member now heads QA → their team includes the report from the sub-unit, with due status.
  const team = await srv.request('GET', '/api/org-units/my-team', { token: memberToken });
  assert.equal(team.status, 200);
  const reportEntry = team.body.members.find((m) => m.user.email === 'qa.report@test.local');
  assert.ok(reportEntry, 'report from the sub-unit appears in the head team');
  assert.equal(reportEntry.orgUnitName, 'QA Sub');
  const tr = reportEntry.trainings.find((t) => t.id === trainingId);
  assert.ok(tr, 'required training listed');
  assert.equal(tr.status, 'never', 'never-passed training shows as due (never)');

  // And /me now reports the member as a head.
  const me = await srv.request('GET', '/api/auth/me', { token: memberToken });
  assert.equal(me.body.isHead, true, 'member who heads a unit → isHead true');
});

// ───────────────────────── SYS-ORG-06 — company name ─────────────────────────

test('SYS-ORG-06 / VT-129 (SR-128): admin edits companyName → renames the root unit; non-admin → 403', async () => {
  const put = await srv.request('PUT', '/api/settings', {
    token: adminToken,
    body: { companyName: 'PTW Freiburg' },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.companyName, 'PTW Freiburg');

  const units = await srv.request('GET', '/api/org-units', { token: adminToken });
  const root = units.body.find((o) => o.id === rootId);
  assert.equal(root.name, 'PTW Freiburg', 'root unit renamed to match the company name');

  const forbidden = await srv.request('PUT', '/api/settings', {
    token: memberToken,
    body: { companyName: 'Hacked Inc' },
  });
  assert.equal(forbidden.status, 403, 'non-admin cannot change settings');

  // restore for any later assertions
  await srv.request('PUT', '/api/settings', { token: adminToken, body: { companyName: 'PTW Dosimetry' } });
});

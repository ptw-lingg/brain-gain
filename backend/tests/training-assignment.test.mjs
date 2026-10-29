// Automated API tests for training assignment beyond job roles (SYS-TRN-21/22, SYS-ORG-09):
//   SYS-TRN-21  POST/PUT /api/trainings accept `assignment` ({ everyone, orgUnits[] }) and `roleIds`
//               (the roles that require the training) — admins for any training, trainers for their
//               own; unknown units are dropped, roles are kept in sync with JobRole.trainingIds.
//   SYS-TRN-22  The required-trainings rule set (role OR org unit [optionally subtree] OR everyone)
//               drives GET /api/trainings/mine, GET /api/trainings/trainees and /api/org-units/my-team;
//               "everyone" excludes accounts pending activation.
//   SYS-ORG-09  Deleting an org unit strips it from every training's assignment.
//
// Validation tests: VT-233 (org unit, incl. sub-units), VT-234 (everyone), VT-235 (edited on the
// training by admins and owning trainers; roles stay in sync).
// Stakeholder reqs: SR-197, SR-198, SR-199.
//
// Runs against a freshly-seeded, isolated backend (see helpers/server.mjs). Seeded fixtures:
//   admin@braingain.app / admin123, trainer@braingain.app / trainer123 (owns the seeded trainings),
//   user@braingain.app / user123 (member in the "Lab Technician" role), one root org unit.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, publishSilent } from './helpers/server.mjs';

let srv;
let adminToken;
let trainerToken;
let rootUnitId;
let rdUnitId; // "R&D" under the root
let rdSubUnitId; // "R&D / Software" under R&D
let salesUnitId; // "Sales" under the root
let rdUser; // member of R&D (no roles)
let swUser; // member of R&D / Software (no roles)
let salesUser; // member of Sales (no roles)

async function loginToken(email, password) {
  const res = await srv.request('POST', '/api/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.token;
}

async function createUnit(name, parentId) {
  const res = await srv.request('POST', '/api/org-units', { token: adminToken, body: { name, parentId } });
  assert.equal(res.status, 201, `create unit ${name}`);
  return res.body.id;
}

async function createMember(name, orgUnitId) {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@test.local`;
  const res = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name, email, password: 'secret123', roleIds: [], orgUnitId },
  });
  assert.equal(res.status, 201, `create user ${name}`);
  return { ...res.body, token: await loginToken(email, 'secret123') };
}

/** A published training owned by the seeded trainer, with the given assignment / roleIds. */
async function createTraining(name, extra = {}, token = trainerToken) {
  const res = await srv.request('POST', '/api/trainings', {
    token,
    body: {
      name: { en: name },
      questions: [{ text: { en: 'Q' }, options: [{ en: 'A' }, { en: 'B' }], correctIndices: [0], type: 'single' }],
      ...extra,
    },
  });
  assert.equal(res.status, 201, `create training ${name}`);
  await publishSilent(srv, res.body.id, token);
  return res.body;
}

const mineIds = async (token) => {
  const res = await srv.request('GET', '/api/trainings/mine', { token });
  assert.equal(res.status, 200);
  return new Set(res.body.map((d) => d.training.id));
};

const traineesOf = async (trainingId, token = adminToken) => {
  const res = await srv.request('GET', '/api/trainings/trainees', { token });
  assert.equal(res.status, 200);
  const group = res.body.find((g) => g.training.id === trainingId);
  return new Set((group?.trainees ?? []).map((x) => x.user.id));
};

before(async () => {
  srv = await startTestServer();
  adminToken = await loginToken('admin@braingain.app', 'admin123');
  trainerToken = await loginToken('trainer@braingain.app', 'trainer123');
  const units = await srv.request('GET', '/api/org-units', { token: adminToken });
  rootUnitId = units.body.find((u) => u.parentId === null).id;
  rdUnitId = await createUnit('R&D', rootUnitId);
  rdSubUnitId = await createUnit('Software', rdUnitId);
  salesUnitId = await createUnit('Sales', rootUnitId);
  rdUser = await createMember('Rd Member', rdUnitId);
  swUser = await createMember('Sw Member', rdSubUnitId);
  salesUser = await createMember('Sales Member', salesUnitId);
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SYS-TRN-22 / VT-233 — org unit, with and without sub-units ─────────────────────────

test('SYS-TRN-22 / VT-233 (SR-197): a training assigned to an org unit incl. sub-units is required by the whole subtree', async () => {
  const tr = await createTraining('Subtree training', {
    assignment: { everyone: false, orgUnits: [{ orgUnitId: rdUnitId, includeSubunits: true }] },
  });
  assert.deepEqual(tr.assignment, { everyone: false, orgUnits: [{ orgUnitId: rdUnitId, includeSubunits: true }] });

  assert.ok((await mineIds(rdUser.token)).has(tr.id), 'direct member of R&D sees it');
  assert.ok((await mineIds(swUser.token)).has(tr.id), 'member of the sub-unit sees it');
  assert.ok(!(await mineIds(salesUser.token)).has(tr.id), 'member of an unrelated unit does not');

  const trainees = await traineesOf(tr.id);
  assert.ok(trainees.has(rdUser.id) && trainees.has(swUser.id), 'Trainees lists both unit members');
  assert.ok(!trainees.has(salesUser.id), 'Trainees omits the Sales member');
});

test('SYS-TRN-22 / VT-233 (SR-197): without sub-units only the direct members of the unit are required', async () => {
  const tr = await createTraining('Unit-only training', {
    assignment: { everyone: false, orgUnits: [{ orgUnitId: rdUnitId, includeSubunits: false }] },
  });
  assert.ok((await mineIds(rdUser.token)).has(tr.id), 'direct member of R&D sees it');
  assert.ok(!(await mineIds(swUser.token)).has(tr.id), 'the sub-unit member does not');
  const trainees = await traineesOf(tr.id);
  assert.ok(trainees.has(rdUser.id) && !trainees.has(swUser.id));
});

test('SYS-TRN-22 / VT-233 (SR-197): My Team of a unit head reflects org-unit assignments', async () => {
  // The seeded trainer becomes head of R&D; the subtree training above is required by its members.
  const unit = await srv.request('GET', '/api/org-units', { token: adminToken });
  const rd = unit.body.find((u) => u.id === rdUnitId);
  const trainer = (await srv.request('GET', '/api/users', { token: adminToken })).body.find((u) => u.email === 'trainer@braingain.app');
  const put = await srv.request('PUT', `/api/org-units/${rdUnitId}`, { token: adminToken, body: { ...rd, headUserId: trainer.id } });
  assert.equal(put.status, 200);
  const team = await srv.request('GET', '/api/org-units/my-team', { token: trainerToken });
  assert.equal(team.status, 200);
  const sw = team.body.members.find((m) => m.user.id === swUser.id);
  assert.ok(sw, 'the sub-unit member is in the head\'s team');
  assert.ok(sw.trainings.some((x) => x.name.en === 'Subtree training'), 'with the subtree training listed');
  assert.ok(!sw.trainings.some((x) => x.name.en === 'Unit-only training'), 'but not the unit-only one');
});

// ───────────────────────── SYS-TRN-22 / VT-234 — everyone ─────────────────────────

test('SYS-TRN-22 / VT-234 (SR-198): a training assigned to everyone is required by every active account, not by pending ones', async () => {
  const tr = await createTraining('Everyone training', { assignment: { everyone: true, orgUnits: [] } });
  assert.deepEqual(tr.assignment, { everyone: true, orgUnits: [] });

  for (const token of [rdUser.token, swUser.token, salesUser.token, trainerToken, adminToken]) {
    assert.ok((await mineIds(token)).has(tr.id), 'every active account sees it');
  }
  // An imported account is pending activation (isDisabled) — not "everyone" yet.
  const imported = await srv.request('POST', '/api/users/import', {
    token: adminToken,
    body: { commit: true, rows: [{ name: 'Pending Person', email: 'pending.person@test.local', roles: [] }] },
  });
  assert.equal(imported.status, 200);
  const pending = (await srv.request('GET', '/api/users', { token: adminToken })).body.find((u) => u.email === 'pending.person@test.local');
  assert.ok(pending?.isDisabled, 'the imported account is pending');
  const trainees = await traineesOf(tr.id);
  assert.ok(trainees.has(rdUser.id) && trainees.has(salesUser.id), 'Trainees lists active accounts');
  assert.ok(!trainees.has(pending.id), 'Trainees omits the pending account');
});

// ───────────────────────── SYS-TRN-21 / VT-235 — edited on the training ─────────────────────────

test('SYS-TRN-21 / VT-235 (SR-199): roleIds on the training editor keep JobRole.trainingIds in sync (owning trainer)', async () => {
  const roles = await srv.request('GET', '/api/roles', { token: adminToken });
  const lab = roles.body.find((r) => r.name === 'Lab Technician');
  const tr = await createTraining('Role-synced training', { roleIds: [lab.id] });

  let after = (await srv.request('GET', '/api/roles', { token: adminToken })).body.find((r) => r.id === lab.id);
  assert.ok(after.trainingIds.includes(tr.id), 'the role now requires the training');
  const memberToken = await loginToken('user@braingain.app', 'user123');
  assert.ok((await mineIds(memberToken)).has(tr.id), 'the role holder sees it');

  // The owning trainer unticks the role → the role no longer requires it; other trainingIds survive.
  const put = await srv.request('PUT', `/api/trainings/${tr.id}`, { token: trainerToken, body: { roleIds: [] } });
  assert.equal(put.status, 200);
  after = (await srv.request('GET', '/api/roles', { token: adminToken })).body.find((r) => r.id === lab.id);
  assert.ok(!after.trainingIds.includes(tr.id), 'untucked from the role');
  assert.equal(after.trainingIds.length, lab.trainingIds.length, 'the role\'s other trainings are untouched');
  assert.ok(!(await mineIds(memberToken)).has(tr.id));

  // The role change is audited like an edit in the role editor.
  const audit = await srv.request('GET', `/api/audit?entityType=role&action=update&q=${encodeURIComponent('Lab Technician')}`, { token: adminToken });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.entries.some((e) => e.changes?.some((c) => c.field === 'trainingIds')), 'role trainingIds change audited');
});

test('SYS-TRN-21 / VT-235 (SR-199): assignment is master data — present-or-keep, null clears, unknown units are dropped', async () => {
  const tr = await createTraining('Assignment master data', {
    assignment: { everyone: false, orgUnits: [{ orgUnitId: salesUnitId }] },
  });
  assert.deepEqual(tr.assignment, { everyone: false, orgUnits: [{ orgUnitId: salesUnitId, includeSubunits: true }] }, 'includeSubunits defaults to true');

  // A save without `assignment` keeps it; the version is untouched (no content changed).
  let put = await srv.request('PUT', `/api/trainings/${tr.id}`, { token: trainerToken, body: { durationMinutes: 15 } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.assignment.orgUnits.map((e) => e.orgUnitId), [salesUnitId]);
  assert.equal(put.body.version, 1);
  assert.equal(put.body.draft, undefined, 'assignment never stages a draft');

  // Unknown / duplicate units are dropped silently; `everyone` is coerced to a boolean.
  put = await srv.request('PUT', `/api/trainings/${tr.id}`, {
    token: trainerToken,
    body: { assignment: { everyone: 'yes', orgUnits: [{ orgUnitId: rdUnitId }, { orgUnitId: rdUnitId }, { orgUnitId: '00000000-0000-4000-8000-000000000000' }, { orgUnitId: 'nope' }] } },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.assignment, { everyone: true, orgUnits: [{ orgUnitId: rdUnitId, includeSubunits: true }] });

  // null clears; an all-off assignment disappears from the record as well.
  put = await srv.request('PUT', `/api/trainings/${tr.id}`, { token: trainerToken, body: { assignment: null } });
  assert.equal(put.status, 200);
  assert.equal(put.body.assignment, undefined);
  put = await srv.request('PUT', `/api/trainings/${tr.id}`, { token: trainerToken, body: { assignment: { everyone: false, orgUnits: [] } } });
  assert.equal(put.body.assignment, undefined);
  assert.ok(!(await mineIds(salesUser.token)).has(tr.id), 'nobody is required any more');
});

test('SYS-TRN-21 / VT-235 (SR-199, SR-003): only admins and the owning trainer may assign; another trainer gets 403', async () => {
  const other = await srv.request('POST', '/api/users', {
    token: adminToken,
    body: { name: 'Other Trainer', email: 'other.trainer@test.local', password: 'secret123', roleIds: [], isTrainer: true },
  });
  assert.equal(other.status, 201);
  const otherToken = await loginToken('other.trainer@test.local', 'secret123');
  const tr = await createTraining('Owned by seeded trainer');

  const denied = await srv.request('PUT', `/api/trainings/${tr.id}`, { token: otherToken, body: { assignment: { everyone: true, orgUnits: [] } } });
  assert.equal(denied.status, 403);
  const byAdmin = await srv.request('PUT', `/api/trainings/${tr.id}`, { token: adminToken, body: { assignment: { everyone: true, orgUnits: [] } } });
  assert.equal(byAdmin.status, 200);
  assert.equal(byAdmin.body.assignment.everyone, true);
});

// ───────────────────────── SYS-ORG-09 — deleting a unit strips assignments ─────────────────────────

test('SYS-ORG-09 (SR-197): deleting an org unit removes it from every training\'s assignment', async () => {
  const unitId = await createUnit('Temporary', rootUnitId);
  const tr = await createTraining('Strip on delete', {
    assignment: { everyone: false, orgUnits: [{ orgUnitId: unitId, includeSubunits: true }, { orgUnitId: salesUnitId, includeSubunits: false }] },
  });
  const del = await srv.request('DELETE', `/api/org-units/${unitId}`, { token: adminToken });
  assert.equal(del.status, 204);
  const got = await srv.request('GET', `/api/trainings/${tr.id}`, { token: adminToken });
  assert.deepEqual(got.body.assignment, { everyone: false, orgUnits: [{ orgUnitId: salesUnitId, includeSubunits: false }] });

  // When the deleted unit was the only rule, the assignment disappears entirely.
  const soleId = await createUnit('Sole', rootUnitId);
  const sole = await createTraining('Sole unit', { assignment: { everyone: false, orgUnits: [{ orgUnitId: soleId }] } });
  await srv.request('DELETE', `/api/org-units/${soleId}`, { token: adminToken });
  const got2 = await srv.request('GET', `/api/trainings/${sole.id}`, { token: adminToken });
  assert.equal(got2.body.assignment, undefined);
});

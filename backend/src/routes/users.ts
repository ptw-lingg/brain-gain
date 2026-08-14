import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import type { JobRole, OrgUnit, User } from '../types';
import { readStore, writeStore } from '../services/fileStore';
import { authenticate, requireAdmin, type AuthRequest } from '../middleware/auth';
import { rootOrgUnitId } from '../services/orgUnits';
import { auditEvent, diffEntities } from '../services/audit';
import { toSafeUser } from './auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = Router();

router.use(authenticate, requireAdmin);

// GET /api/users
router.get('/', async (_req, res) => {
  const users = await readStore<User>('users');
  res.json(users.map(toSafeUser));
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const users = await readStore<User>('users');
  const user = users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  return res.json(toSafeUser(user));
});

// GET /api/users/:id/activation — admin re-fetches the one-time activation token for a still-pending
// user (disabled, no password yet), so a lost link can be re-handed-out without recreating the account.
router.get('/:id/activation', async (req, res) => {
  const users = await readStore<User>('users');
  const user = users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (!user.isDisabled || user.passwordHash || !user.activationToken) {
    return res.status(409).json({ error: 'This account is not pending activation' });
  }
  return res.json({ activationToken: user.activationToken });
});

// POST /api/users  — admin creates a user
router.post('/', async (req: AuthRequest, res) => {
  const { name, email, password, roleIds, isAdmin, isTrainer, orgUnitId } = req.body ?? {};
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'name, email, password are required' });
  }
  // Membership is required: an explicit unit must exist; if omitted, fall back to the root unit so
  // the "everyone belongs to exactly one unit" invariant always holds.
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  if (orgUnitId !== undefined && (typeof orgUnitId !== 'string' || !orgUnits.some((o) => o.id === orgUnitId))) {
    return res.status(400).json({ error: 'orgUnitId does not exist' });
  }
  const resolvedOrgUnitId = typeof orgUnitId === 'string' && orgUnitId ? orgUnitId : await rootOrgUnitId();
  const users = await readStore<User>('users');
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already in use' });
  }
  const user: User = {
    id: randomUUID(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    roleIds: Array.isArray(roleIds) ? roleIds : [],
    orgUnitId: resolvedOrgUnitId,
    isAdmin: Boolean(isAdmin),
    isTrainer: Boolean(isTrainer),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await writeStore('users', users);
  await auditEvent(req.user ?? null, 'create', { type: 'user', id: user.id, name: user.email });
  return res.status(201).json(toSafeUser(user));
});

// POST /api/users/import — admin bulk-imports users pasted from a spreadsheet.
//
// Body: { rows: { name, email, roles }[], commit?: boolean }. `roles` is a list of job-role NAMES
// (a single comma/semicolon-separated string is also accepted). The server is authoritative for all
// matching, validation and diffing (SR-104): the client only tokenizes the paste for display.
//
// With commit=false (the default) this is a dry run — it writes nothing and returns the plan so the
// admin can preview exactly what will change. With commit=true the non-error rows are applied:
//   • create → a new Member (isAdmin/isTrainer false), disabled and password-less, carrying a
//     one-time activationToken. The token is returned for THIS row only (the admin hands out the link).
//   • update → an existing user (matched by email) has its name set and its roleIds fully replaced
//     with the row's matched roles. Access flags, password and disabled state are left untouched.
// A row is an error (never applied) when the name/email is missing or invalid, the email is duplicated
// earlier in the paste, or any role name matches no existing role — so a typo can't mis-assign roles.
router.post('/import', async (req: AuthRequest, res) => {
  const rawRows = (req.body ?? {}).rows;
  const commit = (req.body ?? {}).commit === true;
  if (!Array.isArray(rawRows)) {
    return res.status(400).json({ error: 'rows must be an array' });
  }

  const users = await readStore<User>('users');
  const roles = await readStore<JobRole>('roles');
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  // New users with no Org Unit value fall back to the root unit (membership invariant).
  const rootUnitId = (orgUnits.find((o) => o.parentId === null) ?? orgUnits[0])?.id;
  const roleByName = new Map(roles.map((r) => [r.name.trim().toLowerCase(), r] as const));
  const roleName = (id: string): string => roles.find((r) => r.id === id)?.name ?? id;
  const unitByName = new Map(orgUnits.map((o) => [o.name.trim().toLowerCase(), o] as const));
  const unitName = (id: string | undefined): string =>
    orgUnits.find((o) => o.id === id)?.name ?? '';
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u] as const));

  const seenEmails = new Set<string>(); // emails seen earlier in THIS paste (duplicate guard)

  type PlanRow = {
    index: number;
    name: string;
    email: string;
    action: 'create' | 'update' | 'unchanged' | 'error';
    errors: string[];
    matchedRoleIds: string[];
    unknownRoles: string[];
    matchedOrgUnitId?: string; // resolved org unit (when an Org Unit value was provided & matched)
    unknownOrgUnit?: string; // the org-unit value that matched nothing
    changes: {
      name?: { from: string; to: string };
      roles?: { added: string[]; removed: string[] };
      orgUnit?: { from: string; to: string };
    };
    activationToken?: string; // set only on a committed create
  };

  const plan: PlanRow[] = rawRows.map((raw, index) => {
    const name = String(raw?.name ?? '').trim();
    const email = String(raw?.email ?? '').trim();
    // Accept roles as an array, a single comma/semicolon-separated string, or an array whose
    // entries themselves contain separators — all flatten to a clean list of individual names.
    const rawRoles = Array.isArray(raw?.roles)
      ? raw.roles
      : typeof raw?.roles === 'string'
        ? [raw.roles]
        : [];
    const roleNames = rawRoles
      .flatMap((r: unknown) => String(r).split(/[,;]/))
      .map((r: string) => r.trim())
      .filter(Boolean);

    const errors: string[] = [];
    const unknownRoles: string[] = [];
    const matchedRoleIds: string[] = [];
    for (const rn of roleNames) {
      const match = roleByName.get(rn.toLowerCase());
      if (!match) unknownRoles.push(rn);
      else if (!matchedRoleIds.includes(match.id)) matchedRoleIds.push(match.id);
    }

    // Org unit: a single name, matched case-insensitively (mirrors roles). Unknown → row error.
    const orgUnitRaw = String(raw?.orgUnit ?? '').trim();
    let matchedOrgUnitId: string | undefined;
    let unknownOrgUnit: string | undefined;
    if (orgUnitRaw) {
      const m = unitByName.get(orgUnitRaw.toLowerCase());
      if (m) matchedOrgUnitId = m.id;
      else unknownOrgUnit = orgUnitRaw;
    }

    if (!name) errors.push('Name is required');
    if (!email) errors.push('Email is required');
    else if (!EMAIL_RE.test(email)) errors.push('Email is not valid');
    else if (seenEmails.has(email.toLowerCase())) errors.push('Duplicate email in the pasted data');
    if (unknownRoles.length) errors.push(`Unknown role(s): ${unknownRoles.join(', ')}`);
    if (unknownOrgUnit) errors.push(`Unknown org unit: ${unknownOrgUnit}`);
    if (email) seenEmails.add(email.toLowerCase());

    const existing = userByEmail.get(email.toLowerCase());

    if (errors.length) {
      return { index, name, email, action: 'error', errors, matchedRoleIds, unknownRoles, matchedOrgUnitId, unknownOrgUnit, changes: {} };
    }

    if (!existing) {
      return { index, name, email, action: 'create', errors, matchedRoleIds, unknownRoles, matchedOrgUnitId, changes: {} };
    }

    const changes: PlanRow['changes'] = {};
    if (existing.name !== name) changes.name = { from: existing.name, to: name };
    const added = matchedRoleIds.filter((id) => !existing.roleIds.includes(id)).map(roleName);
    const removed = existing.roleIds.filter((id) => !matchedRoleIds.includes(id)).map(roleName);
    if (added.length || removed.length) changes.roles = { added, removed };
    // Only treat a provided org unit that differs as a change; an absent column leaves it untouched.
    if (matchedOrgUnitId && existing.orgUnitId !== matchedOrgUnitId) {
      changes.orgUnit = { from: unitName(existing.orgUnitId), to: unitName(matchedOrgUnitId) };
    }
    const action = changes.name || changes.roles || changes.orgUnit ? 'update' : 'unchanged';
    return { index, name, email, action, errors, matchedRoleIds, unknownRoles, matchedOrgUnitId, changes };
  });

  if (commit) {
    const now = new Date().toISOString();
    let dirty = false;
    for (const row of plan) {
      if (row.action === 'create') {
        const token = randomBytes(32).toString('base64url');
        const created: User = {
          id: randomUUID(),
          email: row.email,
          name: row.name,
          roleIds: row.matchedRoleIds,
          orgUnitId: row.matchedOrgUnitId ?? rootUnitId,
          isAdmin: false,
          isTrainer: false,
          isDisabled: true,
          activationToken: token,
          createdAt: now,
        };
        users.push(created);
        row.activationToken = token; // returned once, to the admin who imported
        dirty = true;
        await auditEvent(req.user ?? null, 'create', { type: 'user', id: created.id, name: created.email }, { details: 'imported' });
      } else if (row.action === 'update') {
        const u = users.find((x) => x.email.toLowerCase() === row.email.toLowerCase());
        if (u) {
          const before = { ...u };
          u.name = row.name;
          u.roleIds = row.matchedRoleIds;
          if (row.matchedOrgUnitId) u.orgUnitId = row.matchedOrgUnitId; // only when provided
          dirty = true;
          await auditEvent(
            req.user ?? null,
            'update',
            { type: 'user', id: u.id, name: u.email },
            { changes: diffEntities(before, u), details: 'imported' },
          );
        }
      }
    }
    if (dirty) await writeStore('users', users);
  }

  const summary = {
    create: plan.filter((r) => r.action === 'create').length,
    update: plan.filter((r) => r.action === 'update').length,
    unchanged: plan.filter((r) => r.action === 'unchanged').length,
    error: plan.filter((r) => r.action === 'error').length,
  };
  return res.json({ committed: commit, summary, rows: plan });
});

// PUT /api/users/:id
router.put('/:id', async (req: AuthRequest, res) => {
  const { name, email, roleIds, isAdmin, isTrainer, password, orgUnitId } = req.body ?? {};
  const users = await readStore<User>('users');
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const current = users[idx];
  if (orgUnitId !== undefined) {
    const orgUnits = await readStore<OrgUnit>('orgUnits');
    if (typeof orgUnitId !== 'string' || !orgUnits.some((o) => o.id === orgUnitId)) {
      return res.status(400).json({ error: 'orgUnitId does not exist' });
    }
  }
  const updated: User = {
    ...current,
    name: typeof name === 'string' ? name : current.name,
    email: typeof email === 'string' ? email : current.email,
    roleIds: Array.isArray(roleIds) ? roleIds : current.roleIds,
    orgUnitId: typeof orgUnitId === 'string' ? orgUnitId : current.orgUnitId,
    isAdmin: typeof isAdmin === 'boolean' ? isAdmin : current.isAdmin,
    isTrainer: typeof isTrainer === 'boolean' ? isTrainer : current.isTrainer,
    passwordHash:
      typeof password === 'string' && password.length > 0
        ? await bcrypt.hash(password, 10)
        : current.passwordHash,
  };
  users[idx] = updated;
  await writeStore('users', users);
  await auditEvent(req.user ?? null, 'update', { type: 'user', id: updated.id, name: updated.email }, { changes: diffEntities(current, updated) });
  return res.json(toSafeUser(updated));
});

// DELETE /api/users/:id
router.delete('/:id', async (req: AuthRequest, res) => {
  const users = await readStore<User>('users');
  const removed = users.find((u) => u.id === req.params.id);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  await writeStore('users', users.filter((u) => u.id !== req.params.id));
  await auditEvent(req.user ?? null, 'delete', { type: 'user', id: removed.id, name: removed.email });
  return res.status(204).end();
});

export default router;

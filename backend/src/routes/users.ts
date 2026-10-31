import { asyncRouter } from '../middleware/asyncRouter';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { isAvatarValue, type JobRole, type OrgUnit, type User } from '../types';
import { readSettings, readStore, transaction, updateStore, writeStore } from '../services/fileStore';
import { issueActivation, markActivated } from '../services/activation';
import { MailError, isSmtpConfigured, sendMail } from '../services/mail';
import { isEntraConfigured } from '../services/entra';
import { authenticate, requireAdmin, type AuthRequest } from '../middleware/auth';
import { rootOrgUnitId } from '../services/orgUnits';
import { auditEvent, diffEntities, labelIdList } from '../services/audit';
import { toSafeUser } from './auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = asyncRouter();

router.use(authenticate, requireAdmin);

// The admin's view of a user: SafeUser plus whether a local password exists — the pending-activation
// panel needs it to tell whether "Activate now" can keep the account's current password.
const adminUser = (u: User) => ({ ...toSafeUser(u), hasPassword: Boolean(u.passwordHash) });

// GET /api/users
router.get('/', async (_req, res) => {
  const users = await readStore<User>('users');
  res.json(users.map(adminUser));
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const users = await readStore<User>('users');
  const user = users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  return res.json(adminUser(user));
});

// ── Pending activation (SR-193 / SR-194) ─────────────────────────────────────────────────────────
// A disabled account is "pending activation". The admin can hand out a new link, email it (SMTP), or
// enable the account directly. Every new link replaces — and so revokes — the previous one.

const NOT_PENDING = 'This account is not pending activation';

/** The origin users reach the app at — the base of an emailed link (APP_ORIGIN behind a proxy/Vite). */
function publicOrigin(req: AuthRequest): string {
  return (process.env.APP_ORIGIN ?? `https://${req.headers.host ?? 'localhost'}`).replace(/\/+$/, '');
}

/** Issue a new link for a pending account under the store lock. */
async function rotateActivation(
  id: string,
): Promise<{ status: number; error: string } | { user: User; token: string; expiresAt: string }> {
  return transaction(async () => {
    const users = await readStore<User>('users');
    const user = users.find((u) => u.id === id);
    if (!user) return { status: 404, error: 'Not found' };
    if (!user.isDisabled) return { status: 409, error: NOT_PENDING };
    const { token, expiresAt } = issueActivation(user);
    await writeStore('users', users);
    return { user, token, expiresAt };
  });
}

// POST /api/users/:id/activation-link — a NEW one-time link for a pending account, to copy and hand
// out (works without SMTP). The token is returned to the admin only; the previous link stops working.
router.post('/:id/activation-link', async (req: AuthRequest, res) => {
  const out = await rotateActivation(req.params.id);
  if ('error' in out) return res.status(out.status).json({ error: out.error });
  await auditEvent(req.user ?? null, 'update', { type: 'user', id: out.user.id, name: out.user.email }, {
    details: `activation link issued (valid until ${out.expiresAt.slice(0, 10)})`,
  });
  return res.json({ activationToken: out.token, expiresAt: out.expiresAt });
});

// POST /api/users/:id/activation-email — email a NEW link to the pending account's address. 503 when
// SMTP is not configured (nothing changes then); 502 when the server refused the message (the link was
// already rotated — copy it instead). The token never appears in the response.
router.post('/:id/activation-email', async (req: AuthRequest, res) => {
  const settings = await readSettings();
  if (!isSmtpConfigured(settings)) {
    return res.status(503).json({ error: 'Email is not configured. Copy the activation link instead.' });
  }
  const out = await rotateActivation(req.params.id);
  if ('error' in out) return res.status(out.status).json({ error: out.error });
  const link = `${publicOrigin(req)}/activate?token=${out.token}`;
  const until = new Date(out.expiresAt);
  const company = settings.companyName?.trim() || 'BrainGain';
  try {
    await sendMail(settings, {
      to: [out.user.email],
      subject: `BrainGain: Konto aktivieren / Activate your account`,
      text: [
        `Hallo ${out.user.name},`,
        '',
        `für Sie wurde ein BrainGain-Konto bei ${company} angelegt. Öffnen Sie diesen Link und legen Sie ein Passwort fest:`,
        link,
        `Der Link ist gültig bis ${until.toLocaleDateString('de-DE')} und kann nur einmal verwendet werden.`,
        '',
        '---',
        '',
        `Hello ${out.user.name},`,
        '',
        `a BrainGain account has been created for you at ${company}. Open this link and choose a password:`,
        link,
        `The link is valid until ${out.expiresAt.slice(0, 10)} and can be used only once.`,
      ].join('\n'),
    });
  } catch (err) {
    if (!(err instanceof MailError)) console.error('Activation email error:', err);
    return res.status(502).json({ error: 'The email could not be sent. Check the SMTP settings or copy the link instead.' });
  }
  await auditEvent(req.user ?? null, 'update', { type: 'user', id: out.user.id, name: out.user.email }, {
    details: `activation link emailed (valid until ${out.expiresAt.slice(0, 10)})`,
  });
  return res.json({ sentTo: out.user.email, expiresAt: out.expiresAt });
});

// POST /api/users/:id/activate { password? } — the admin enables a pending account directly. With a
// password (≥ 8 chars) it becomes the account's password; without one the account keeps the password
// it already has, or — when it has none — signs in with Microsoft, which must then be configured.
router.post('/:id/activate', async (req: AuthRequest, res) => {
  const { password } = req.body ?? {};
  if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 8)) {
    return res.status(400).json({ error: 'The password must be at least 8 characters' });
  }
  const newHash = typeof password === 'string' && password ? await bcrypt.hash(password, 10) : undefined;
  const ssoReady = isEntraConfigured(await readSettings());
  const outcome = await transaction(async (): Promise<{ status: number; error: string } | { user: User }> => {
    const users = await readStore<User>('users');
    const user = users.find((u) => u.id === req.params.id);
    if (!user) return { status: 404, error: 'Not found' };
    if (!user.isDisabled) return { status: 409, error: NOT_PENDING };
    if (!newHash && !user.passwordHash && !ssoReady) {
      return {
        status: 400,
        error: 'Set a password: this account has none and Microsoft sign-in is not configured',
      };
    }
    if (newHash) user.passwordHash = newHash;
    markActivated(user);
    await writeStore('users', users);
    return { user };
  });
  if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
  const { user } = outcome;
  await auditEvent(req.user ?? null, 'activate', { type: 'user', id: user.id, name: user.email }, {
    details: newHash ? 'activated by an administrator (password set)' : 'activated by an administrator',
  });
  return res.json(adminUser(user));
});

// POST /api/users  — admin creates a user
router.post('/', async (req: AuthRequest, res) => {
  const { name, email, password, roleIds, isAdmin, isTrainer, orgUnitId } = req.body ?? {};
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'name, email, password are required' });
  }
  // Hash BEFORE taking the store lock: bcrypt takes ~100 ms and does not depend on store state.
  const passwordHash = await bcrypt.hash(password, 10);
  const outcome = await transaction(async (): Promise<{ status: number; error: string } | { user: User }> => {
    // Membership is required: an explicit unit must exist; if omitted, fall back to the root unit so
    // the "everyone belongs to exactly one unit" invariant always holds.
    const orgUnits = await readStore<OrgUnit>('orgUnits');
    if (orgUnitId !== undefined && (typeof orgUnitId !== 'string' || !orgUnits.some((o) => o.id === orgUnitId))) {
      return { status: 400, error: 'orgUnitId does not exist' };
    }
    const resolvedOrgUnitId = typeof orgUnitId === 'string' && orgUnitId ? orgUnitId : await rootOrgUnitId();
    const users = await readStore<User>('users');
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return { status: 409, error: 'Email already in use' };
    }
    const user: User = {
      id: randomUUID(),
      name,
      email,
      passwordHash,
      roleIds: Array.isArray(roleIds) ? roleIds : [],
      orgUnitId: resolvedOrgUnitId,
      isAdmin: Boolean(isAdmin),
      isTrainer: Boolean(isTrainer),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await writeStore('users', users);
    return { user };
  });
  if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
  const { user } = outcome;
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

  // The plan is computed and (on commit) applied inside ONE transaction, so the diff the admin
  // previewed cannot be applied over a users store that changed in between. Audit entries are
  // collected and appended after the write, keeping the lock free of audit I/O.
  const auditQueue: (() => Promise<void>)[] = [];
  const response = await transaction(async () => {
  const users = await readStore<User>('users');
  const roles = await readStore<JobRole>('roles');
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  // New users with no Org Unit value fall back to the root unit (membership invariant).
  const rootUnitId = (orgUnits.find((o) => o.parentId === null) ?? orgUnits[0])?.id;
  const roleByName = new Map(roles.map((r) => [r.name.trim().toLowerCase(), r] as const));
  const roleByIdName = (id: string): string | undefined => roles.find((r) => r.id === id)?.name;
  const roleName = (id: string): string => roleByIdName(id) ?? id;
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
    activationExpiresAt?: string; // ISO — when that link stops working
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
        const created: User = {
          id: randomUUID(),
          email: row.email,
          name: row.name,
          roleIds: row.matchedRoleIds,
          orgUnitId: row.matchedOrgUnitId ?? rootUnitId,
          isAdmin: false,
          isTrainer: false,
          isDisabled: true,
          createdAt: now,
        };
        const { token, expiresAt } = issueActivation(created);
        users.push(created);
        row.activationToken = token; // returned once, to the admin who imported
        row.activationExpiresAt = expiresAt;
        dirty = true;
        auditQueue.push(() =>
          auditEvent(req.user ?? null, 'create', { type: 'user', id: created.id, name: created.email }, { details: 'imported' }),
        );
      } else if (row.action === 'update') {
        const u = users.find((x) => x.email.toLowerCase() === row.email.toLowerCase());
        if (u) {
          const before = { ...u };
          u.name = row.name;
          u.roleIds = row.matchedRoleIds;
          if (row.matchedOrgUnitId) u.orgUnitId = row.matchedOrgUnitId; // only when provided
          dirty = true;
          const changes = labelIdList(diffEntities(before, u), 'roleIds', roleByIdName);
          auditQueue.push(() =>
            auditEvent(
              req.user ?? null,
              'update',
              { type: 'user', id: u.id, name: u.email },
              { changes, details: 'imported' },
            ),
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
  return { committed: commit, summary, rows: plan };
  });
  for (const emit of auditQueue) await emit();
  return res.json(response);
});

// PUT /api/users/:id
router.put('/:id', async (req: AuthRequest, res) => {
  const { name, email, roleIds, isAdmin, isTrainer, password, orgUnitId, avatar } = req.body ?? {};
  if (avatar !== undefined && !isAvatarValue(avatar)) {
    return res.status(400).json({ error: 'avatar must be null or a small data:image/png|jpeg|webp URL' });
  }
  // Hash BEFORE taking the store lock (~100 ms, independent of store state).
  const newHash = typeof password === 'string' && password.length > 0 ? await bcrypt.hash(password, 10) : undefined;
  const outcome = await transaction(
    async (): Promise<{ status: number; error: string } | { current: User; updated: User }> => {
      const users = await readStore<User>('users');
      const idx = users.findIndex((u) => u.id === req.params.id);
      if (idx === -1) return { status: 404, error: 'Not found' };
      const current = users[idx];
      if (orgUnitId !== undefined) {
        const orgUnits = await readStore<OrgUnit>('orgUnits');
        if (typeof orgUnitId !== 'string' || !orgUnits.some((o) => o.id === orgUnitId)) {
          return { status: 400, error: 'orgUnitId does not exist' };
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
        passwordHash: newHash ?? current.passwordHash,
      };
      if (avatar === null) delete updated.avatar;
      else if (avatar !== undefined) updated.avatar = avatar;
      // Setting a password for a pending account IS activating it — before 1.5.0 the password was
      // stored but the account stayed disabled, and its link died with it (no way back in).
      if (newHash && updated.isDisabled) markActivated(updated);
      users[idx] = updated;
      await writeStore('users', users);
      return { current, updated };
    },
  );
  if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
  const { current, updated } = outcome;
  // Role assignments are logged as "Name (id)" so the entry reads without a lookup (SYS-AUD-02).
  const roles = await readStore<JobRole>('roles');
  const changes = labelIdList(diffEntities(current, updated), 'roleIds', (id) => roles.find((r) => r.id === id)?.name);
  await auditEvent(req.user ?? null, 'update', { type: 'user', id: updated.id, name: updated.email }, { changes });
  if (current.isDisabled && !updated.isDisabled) {
    await auditEvent(req.user ?? null, 'activate', { type: 'user', id: updated.id, name: updated.email }, {
      details: 'activated by an administrator (password set)',
    });
  }
  return res.json(adminUser(updated));
});

// DELETE /api/users/:id
router.delete('/:id', async (req: AuthRequest, res) => {
  let removed: User | undefined;
  await updateStore<User>('users', (users) => {
    removed = users.find((u) => u.id === req.params.id);
    return removed ? users.filter((u) => u.id !== req.params.id) : null;
  });
  if (!removed) return res.status(404).json({ error: 'Not found' });
  await auditEvent(req.user ?? null, 'delete', { type: 'user', id: removed.id, name: removed.email });
  return res.status(204).end();
});

export default router;

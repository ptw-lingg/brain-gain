import { asyncRouter } from '../middleware/asyncRouter';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { UI_PREF_KEYS, type OrgUnit, type SafeUser, type User } from '../types';
import { readSettings, readStore, transaction, updateStore, writeStore } from '../services/fileStore';
import { UI_LOCALES } from '../services/locales';
import { rootOrgUnitId } from '../services/orgUnits';
import { authenticate, requireAdmin, signToken, type AuthRequest } from '../middleware/auth';
import { auditEvent } from '../services/audit';
import { activationLinkState, findByActivationToken, markActivated } from '../services/activation';
import {
  EntraAuthError,
  authority,
  isEntraConfigured,
  verifyEntraIdToken,
} from '../services/entra';

// The AuthUser shape for a user acting on their own behalf — what auditEvent records as the actor
// for auth events that happen outside an authenticated request (login, activation, SSO).
const asActor = (u: User) => ({ id: u.id, email: u.email, isAdmin: u.isAdmin, isTrainer: u.isTrainer });

const router = asyncRouter();

export function toSafeUser(user: User): SafeUser {
  const { passwordHash, entraOid, activationToken, ...safe } = user;
  void passwordHash;
  void entraOid;
  void activationToken;
  return safe;
}

// The identity payload the frontend signs in with — SafeUser plus the derived `isHead` flag (true
// when this user heads at least one org unit), which drives the "My Team" nav entry and route
// guard, and `hasPassword` (whether a local password exists), which tells the completion-signature
// dialog whether to offer the password field or only the Microsoft re-login.
async function identityUser(user: User): Promise<SafeUser & { isHead: boolean; hasPassword: boolean }> {
  const orgUnits = await readStore<OrgUnit>('orgUnits');
  return {
    ...toSafeUser(user),
    isHead: orgUnits.some((o) => o.headUserId === user.id),
    hasPassword: Boolean(user.passwordHash),
  };
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const users = await readStore<User>('users');
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  // SSO-only users have no passwordHash and therefore cannot sign in with a password.
  // A disabled account (e.g. imported but not yet activated) cannot sign in at all — the generic
  // message avoids revealing which condition failed (no user enumeration).
  if (
    !user ||
    user.isDisabled ||
    !user.passwordHash ||
    !(await bcrypt.compare(password, user.passwordHash))
  ) {
    // Actor-less on purpose: the attempt did NOT authenticate, so no identity is asserted — only
    // the attempted email is recorded, and the generic reason avoids user enumeration in the log too.
    await auditEvent(null, 'login-failed', { type: 'auth', name: email }, { details: 'invalid credentials or disabled account' });
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken({
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    isTrainer: user.isTrainer,
  });
  await auditEvent(asActor(user), 'login', { type: 'auth', id: user.id, name: user.email });
  return res.json({ token, user: await identityUser(user) });
});

const LINK_INVALID = 'This activation link is invalid or has already been used';
const LINK_EXPIRED = 'This activation link has expired. Ask your administrator for a new one.';

// GET /api/auth/activate/:token  — public: validate a pending-account activation link and return the
// minimal identity the activation page shows ("Set a password for {email}"). No secret leaves here.
// An expired link answers 410 { code: 'expired' } so the page can say so instead of "invalid".
router.get('/activate/:token', async (req, res) => {
  const users = await readStore<User>('users');
  const user = findByActivationToken(users, req.params.token);
  const state = activationLinkState(user);
  if (state === 'expired') return res.status(410).json({ error: LINK_EXPIRED, code: 'expired' });
  if (state !== 'live' || !user) return res.status(404).json({ error: LINK_INVALID });
  return res.json({ email: user.email, name: user.name });
});

// POST /api/auth/activate  { token, password }  — public: a pending user sets their own password,
// which enables the account and consumes the one-time token. Returns a session so they're signed in.
router.post('/activate', async (req, res) => {
  const { token, password } = req.body ?? {};
  if (typeof token !== 'string' || typeof password !== 'string' || password.length < 8) {
    return res
      .status(400)
      .json({ error: 'A token and a password of at least 8 characters are required' });
  }
  // Hash BEFORE taking the store lock: bcrypt takes ~100 ms and does not depend on store state.
  const passwordHash = await bcrypt.hash(password, 10);
  let user: User | undefined;
  // Widened on purpose: assigned inside the callback, so TS must not narrow it to the initializer.
  let state = 'invalid' as ReturnType<typeof activationLinkState>;
  await updateStore<User>('users', (users) => {
    const found = findByActivationToken(users, token);
    state = activationLinkState(found);
    // A spent, bogus, replaced or expired token (or an already-active account) changes nothing.
    if (state !== 'live' || !found) return null;
    found.passwordHash = passwordHash;
    markActivated(found);
    user = found;
    return users;
  });
  if (!user) {
    return state === 'expired'
      ? res.status(410).json({ error: LINK_EXPIRED, code: 'expired' })
      : res.status(400).json({ error: LINK_INVALID });
  }
  await auditEvent(asActor(user), 'activate', { type: 'auth', id: user.id, name: user.email });

  const jwt = signToken({
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    isTrainer: user.isTrainer,
  });
  return res.json({ token: jwt, user: await identityUser(user) });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const users = await readStore<User>('users');
  const user = users.find((u) => u.id === req.user?.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(await identityUser(user));
});

// PUT /api/auth/me  { locale?, prefs? }  — the only self-service profile write: persist the user's
// language and/or UI preferences (the "show only due" filter flags). The profile locale doubles as
// the UI language, and the UI exists only in en/de — material languages are a separate, wider list
// governed by Settings.materialLocales. `prefs` accepts only whitelisted boolean flags and is merged
// per key, so each view updates just its own flag. Refused while impersonating: the token carries
// the TARGET's identity, so a write would silently edit the impersonated user's profile, not the
// admin's.
router.put('/me', authenticate, async (req: AuthRequest, res) => {
  if (req.user?.impersonatorId) {
    return res.status(403).json({ error: 'The profile cannot be changed while impersonating' });
  }
  const { locale, prefs } = req.body ?? {};
  if (locale === undefined && prefs === undefined) {
    return res.status(400).json({ error: 'locale or prefs is required' });
  }
  if (locale !== undefined && (typeof locale !== 'string' || !(UI_LOCALES as readonly string[]).includes(locale))) {
    return res.status(400).json({ error: `locale must be one of: ${UI_LOCALES.join(', ')}` });
  }
  if (prefs !== undefined) {
    const entries = typeof prefs === 'object' && prefs !== null && !Array.isArray(prefs) ? Object.entries(prefs) : null;
    if (!entries || entries.some(([k, v]) => !(UI_PREF_KEYS as readonly string[]).includes(k) || typeof v !== 'boolean')) {
      return res.status(400).json({ error: `prefs accepts boolean flags: ${UI_PREF_KEYS.join(', ')}` });
    }
  }
  // Under the store lock: this is the one write EVERY learner performs, and unlocked it could
  // revert a concurrent admin change (a disabled account, a removed admin flag, a deletion).
  let user: User | undefined;
  await updateStore<User>('users', (users) => {
    user = users.find((u) => u.id === req.user?.id);
    if (!user) return null;
    if (locale !== undefined) user.locale = locale;
    if (prefs !== undefined) user.prefs = { ...user.prefs, ...prefs };
    return users;
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(await identityUser(user));
});

// POST /api/auth/impersonate/:userId  — admin starts a "view as" session.
// Issues a token carrying the TARGET user's identity & flags (so every endpoint and guard
// renders exactly what they would see), plus the impersonator's id for audit + nesting guard.
// Ending the session is purely client-side: the admin's own token is restored, no endpoint needed.
router.post('/impersonate/:userId', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  // Refuse to impersonate from within an impersonation session — keeps the restore stack flat.
  if (req.user?.impersonatorId) {
    return res.status(409).json({ error: 'Already impersonating; stop first' });
  }
  if (req.params.userId === req.user?.id) {
    return res.status(400).json({ error: 'You cannot impersonate yourself' });
  }
  const users = await readStore<User>('users');
  const target = users.find((u) => u.id === req.params.userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  await auditEvent(req.user ?? null, 'impersonate', { type: 'user', id: target.id, name: target.email });
  const token = signToken({
    id: target.id,
    email: target.email,
    isAdmin: target.isAdmin,
    isTrainer: target.isTrainer,
    impersonatorId: req.user!.id,
    impersonatorEmail: req.user!.email,
  });
  return res.json({ token, user: await identityUser(target) });
});

// GET /api/auth/sso/config  — public: the login page needs this before authenticating.
// Returns only the values the browser needs to start MSAL (none are secrets).
router.get('/sso/config', async (_req, res) => {
  const settings = await readSettings();
  if (!isEntraConfigured(settings)) return res.json({ enabled: false });
  return res.json({
    enabled: true,
    clientId: settings.entra.clientId,
    authority: authority(settings.entra.tenantId),
  });
});

// POST /api/auth/sso/entra  — exchange a verified Entra ID token for our own app JWT.
router.post('/sso/entra', async (req, res) => {
  const settings = await readSettings();
  if (!isEntraConfigured(settings)) {
    return res.status(503).json({ error: 'SSO is not configured' });
  }

  const { idToken } = req.body ?? {};
  if (typeof idToken !== 'string' || !idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  let claims;
  try {
    claims = await verifyEntraIdToken(idToken, settings.entra);
  } catch (err) {
    if (err instanceof EntraAuthError) {
      return res.status(401).json({ error: 'Could not verify your Microsoft sign-in' });
    }
    console.error('Entra SSO verification error:', err);
    return res.status(500).json({ error: 'SSO verification failed' });
  }

  // Lookup, link and auto-provision in one transaction: two first sign-ins at the same moment must
  // not lose a user (who would then hold a valid token for an account that does not exist).
  type SsoOutcome =
    | { status: number; error: string }
    | { user: User; audit: 'linked' | 'provisioned' | null };
  const outcome = await transaction(async (): Promise<SsoOutcome> => {
    const users = await readStore<User>('users');
    const existing = users.find((u) => u.entraOid === claims.oid);
    if (existing) return { user: existing, audit: null };

    const byEmail = users.find((u) => u.email.toLowerCase() === claims.email.toLowerCase());
    if (byEmail) {
      // Refuse if this email is already linked to a different Entra account (takeover guard).
      if (byEmail.entraOid && byEmail.entraOid !== claims.oid) {
        return { status: 409, error: 'This account is linked to a different Microsoft user' };
      }
      // Link the Entra account to the existing user. Never touch roles/admin/trainer flags.
      byEmail.entraOid = claims.oid;
      await writeStore('users', users);
      return { user: byEmail, audit: 'linked' };
    }
    // Domain-restricted auto-provision: only emails in the allow-list may create a new member.
    const domain = claims.email.split('@')[1]?.toLowerCase() ?? '';
    const allowed = settings.entra.allowedDomains.map((d) => d.toLowerCase());
    if (!allowed.includes(domain)) {
      return { status: 403, error: 'Your account is not permitted to sign in' };
    }
    const created: User = {
      id: randomUUID(),
      email: claims.email,
      name: claims.name,
      roleIds: [],
      orgUnitId: await rootOrgUnitId(),
      isAdmin: false,
      isTrainer: false,
      entraOid: claims.oid,
      createdAt: new Date().toISOString(),
    };
    users.push(created);
    await writeStore('users', users);
    return { user: created, audit: 'provisioned' };
  });
  if ('error' in outcome) return res.status(outcome.status).json({ error: outcome.error });
  const { user } = outcome;
  if (outcome.audit === 'linked') {
    await auditEvent(asActor(user), 'update', { type: 'user', id: user.id, name: user.email }, { details: 'linked Microsoft account' });
  } else if (outcome.audit === 'provisioned') {
    await auditEvent(asActor(user), 'create', { type: 'user', id: user.id, name: user.email }, { details: 'auto-provisioned via SSO' });
  }

  // A disabled account (e.g. imported but not yet activated) cannot sign in via SSO either.
  if (user.isDisabled) {
    return res.status(403).json({ error: 'Your account is not active yet' });
  }

  const token = signToken({
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    isTrainer: user.isTrainer,
  });
  await auditEvent(asActor(user), 'sso-login', { type: 'auth', id: user.id, name: user.email });
  return res.json({ token, user: await identityUser(user) });
});

export default router;

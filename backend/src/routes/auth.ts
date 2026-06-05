import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { SafeUser, User } from '../types';
import { readSettings, readStore, writeStore } from '../services/fileStore';
import { authenticate, requireAdmin, signToken, type AuthRequest } from '../middleware/auth';
import {
  EntraAuthError,
  authority,
  isEntraConfigured,
  verifyEntraIdToken,
} from '../services/entra';

const router = Router();

export function toSafeUser(user: User): SafeUser {
  const { passwordHash, entraOid, ...safe } = user;
  void passwordHash;
  void entraOid;
  return safe;
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
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken({
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    isTrainer: user.isTrainer,
  });
  return res.json({ token, user: toSafeUser(user) });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const users = await readStore<User>('users');
  const user = users.find((u) => u.id === req.user?.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(toSafeUser(user));
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

  console.log(
    `[impersonate] ${req.user?.email} (${req.user?.id}) → ${target.email} (${target.id})`,
  );
  const token = signToken({
    id: target.id,
    email: target.email,
    isAdmin: target.isAdmin,
    isTrainer: target.isTrainer,
    impersonatorId: req.user!.id,
    impersonatorEmail: req.user!.email,
  });
  return res.json({ token, user: toSafeUser(target) });
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

  const users = await readStore<User>('users');
  let user = users.find((u) => u.entraOid === claims.oid);

  if (!user) {
    const byEmail = users.find((u) => u.email.toLowerCase() === claims.email.toLowerCase());
    if (byEmail) {
      // Refuse if this email is already linked to a different Entra account (takeover guard).
      if (byEmail.entraOid && byEmail.entraOid !== claims.oid) {
        return res.status(409).json({ error: 'This account is linked to a different Microsoft user' });
      }
      // Link the Entra account to the existing user. Never touch roles/admin/trainer flags.
      byEmail.entraOid = claims.oid;
      await writeStore('users', users);
      user = byEmail;
    } else {
      // Domain-restricted auto-provision: only emails in the allow-list may create a new member.
      const domain = claims.email.split('@')[1]?.toLowerCase() ?? '';
      const allowed = settings.entra.allowedDomains.map((d) => d.toLowerCase());
      if (!allowed.includes(domain)) {
        return res.status(403).json({ error: 'Your account is not permitted to sign in' });
      }
      user = {
        id: randomUUID(),
        email: claims.email,
        name: claims.name,
        roleIds: [],
        isAdmin: false,
        isTrainer: false,
        entraOid: claims.oid,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      await writeStore('users', users);
    }
  }

  const token = signToken({
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    isTrainer: user.isTrainer,
  });
  return res.json({ token, user: toSafeUser(user) });
});

export default router;

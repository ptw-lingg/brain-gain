// Account activation — the one-time link a pending (imported) account uses to set its own password,
// and the administrator's controls around it (SR-027, SR-193, SR-194).
//
// A link is live while the account is disabled, holds the token, and the token has not expired.
// Every issue REPLACES the previous token, so handing out or emailing a new link revokes the old one.
// The link is never mailed automatically: the admin copies it, or sends it by email when SMTP is
// configured — and can always enable the account directly instead.

import { randomBytes } from 'crypto';
import type { User } from '../types';
import { readStore, writeStore } from './fileStore';

export const ACTIVATION_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Issue a fresh token valid for ACTIVATION_TTL_DAYS on `user` (mutates it); any earlier token dies. */
export function issueActivation(user: User, now = Date.now()): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now + ACTIVATION_TTL_DAYS * DAY_MS).toISOString();
  user.activationToken = token;
  user.activationExpiresAt = expiresAt;
  return { token, expiresAt };
}

/** The account holding this activation token, if any. */
export function findByActivationToken(users: User[], token: string): User | undefined {
  return token ? users.find((u) => !!u.activationToken && u.activationToken === token) : undefined;
}

/**
 * 'live' → the link may be used; 'expired' → right account, but past its expiry (fails closed when
 * the expiry is missing); 'invalid' → no such link, or the account is no longer pending.
 */
export function activationLinkState(user: User | undefined, now = Date.now()): 'live' | 'expired' | 'invalid' {
  if (!user || !user.isDisabled || !user.activationToken) return 'invalid';
  const expires = user.activationExpiresAt ? Date.parse(user.activationExpiresAt) : NaN;
  return Number.isFinite(expires) && expires > now ? 'live' : 'expired';
}

/** Enable the account and drop every activation artefact (mutates `user`). */
export function markActivated(user: User): void {
  user.isDisabled = false;
  delete user.activationToken;
  delete user.activationExpiresAt;
}

/**
 * Boot/restore normalizer for accounts created before links expired (≤ 1.4.x):
 *   • a pending account whose token has no expiry gets the standard window from now, so links already
 *     handed out keep working for ACTIVATION_TTL_DAYS instead of dying at the upgrade;
 *   • a disabled account that already holds a password (an admin set one before 1.5.0, which did not
 *     enable it) loses its token — the old rules had already killed that link — and stays disabled
 *     until an admin activates it.
 * Idempotent: both shapes are gone after one pass.
 */
export async function migrateActivations(now = Date.now()): Promise<void> {
  const users = await readStore<User>('users');
  let dirty = false;
  for (const u of users) {
    if (!u.isDisabled || !u.activationToken) continue;
    if (u.passwordHash) {
      delete u.activationToken;
      delete u.activationExpiresAt;
      dirty = true;
    } else if (!u.activationExpiresAt) {
      u.activationExpiresAt = new Date(now + ACTIVATION_TTL_DAYS * DAY_MS).toISOString();
      dirty = true;
    }
  }
  if (dirty) await writeStore('users', users);
}

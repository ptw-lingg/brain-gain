// Thin wrapper around MSAL.js for the "Sign in with Microsoft" flow.
//
// The Entra config (client id + authority) is supplied at runtime by the backend
// (GET /api/auth/sso/config), so MSAL is only constructed when SSO is actually enabled.
// We use the popup flow: it returns the ID token in-page, so no callback route is needed.

import {
  createStandardPublicClientApplication,
  type IPublicClientApplication,
} from '@azure/msal-browser';

export interface EntraConfig {
  clientId: string;
  authority: string;
}

let msalPromise: Promise<IPublicClientApplication> | null = null;
let msalKey = '';

/** Lazily build (and cache) a PublicClientApplication. Rebuilds if the config changes. */
function getMsal(config: EntraConfig): Promise<IPublicClientApplication> {
  const key = `${config.clientId}|${config.authority}`;
  if (!msalPromise || msalKey !== key) {
    msalKey = key;
    // The factory runs MSAL v3+'s required initialize() for us.
    msalPromise = createStandardPublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: config.authority,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
  }
  return msalPromise;
}

/** Open the Microsoft sign-in popup and return the raw ID token (a JWT) for the backend to verify. */
export async function signInWithEntra(config: EntraConfig): Promise<string> {
  const msal = await getMsal(config);
  const result = await msal.loginPopup({ scopes: ['openid', 'profile', 'email'] });
  msal.setActiveAccount(result.account);
  return result.idToken;
}

/**
 * Re-authenticate for a completion signature: FORCE a fresh interactive Microsoft sign-in
 * (prompt: 'login' — no cached session counts) carrying the server-issued challenge `nonce`, and
 * return the new ID token. Microsoft echoes the nonce in the token; the backend accepts the token
 * only for a challenge it issued to the acting account, once — which is what proves freshness.
 */
export async function reauthWithEntra(config: EntraConfig, nonce: string): Promise<string> {
  const msal = await getMsal(config);
  const result = await msal.loginPopup({ scopes: ['openid', 'profile', 'email'], prompt: 'login', nonce });
  return result.idToken;
}

/**
 * Classify a failed Microsoft popup for the message the user sees:
 *   'cancelled' → the user closed or abandoned the popup (or one is already open) — say nothing;
 *   a string    → MSAL's own error: Microsoft's AADSTS code when present, else MSAL's errorCode — so a
 *                 consent, tenant or registration problem is named instead of a bare "failed";
 *   null        → not an MSAL error (e.g. our backend refused the token) — the caller's own message.
 */
export function entraFailure(e: unknown): 'cancelled' | string | null {
  const err = e as { errorCode?: unknown; errorMessage?: unknown; response?: unknown };
  if (typeof err?.errorCode !== 'string' || err.response) return null;
  if (['user_cancelled', 'popup_window_error', 'interaction_in_progress'].includes(err.errorCode)) return 'cancelled';
  const message = typeof err.errorMessage === 'string' ? err.errorMessage : '';
  return message.match(/AADSTS\d+/)?.[0] ?? err.errorCode;
}

/** Best-effort local cache clear (no full Microsoft sign-out). Safe to call when SSO was never used. */
export async function signOutEntra(): Promise<void> {
  if (!msalPromise) return;
  try {
    const msal = await msalPromise;
    await msal.clearCache();
  } catch {
    /* ignore — clearing the local cache is best-effort */
  }
}

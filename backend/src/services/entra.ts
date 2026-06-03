// Microsoft Entra ID (Azure AD) ID-token verification.
//
// The browser signs the user in with MSAL and sends us the resulting ID token. We validate it
// against Microsoft's published signing keys and the admin-configured tenant/client, then the
// caller mints our own app JWT. No client secret is involved — this consumes ID tokens only.

import jwt, { type JwtHeader, type JwtPayload } from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import type { EntraSsoSettings, Settings } from '../types';

// Allow 5 minutes of clock skew between this server and Microsoft.
const CLOCK_TOLERANCE_SEC = 300;

/** Thrown when a token is missing/invalid. The route maps this to 401 (vs. 500 for infra errors). */
export class EntraAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntraAuthError';
  }
}

export interface EntraClaims {
  oid: string; // stable Entra object id — used to link a token to a local user
  email: string;
  name: string;
}

/** True only when SSO is switched on and a tenant + client are present. */
export function isEntraConfigured(s: Settings): boolean {
  const e = s.entra;
  return Boolean(e && e.enabled && e.tenantId && e.clientId);
}

export function authority(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}`;
}

// One JWKS client per tenant id. The tenant can change at runtime via Settings, so we key the
// cache by tenant rather than building a single client at startup.
const jwksClients = new Map<string, JwksClient>();

function jwksClientFor(tenantId: string): JwksClient {
  let client = jwksClients.get(tenantId);
  if (!client) {
    client = new JwksClient({
      jwksUri: `${authority(tenantId)}/discovery/v2.0/keys`,
      cache: true,
      cacheMaxAge: 24 * 60 * 60 * 1000, // 24h — key rotation is picked up after this
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    jwksClients.set(tenantId, client);
  }
  return client;
}

/**
 * Verify an Entra ID token and return the claims we provision from.
 * Throws {@link EntraAuthError} for any token-content problem (→ 401); other errors (e.g. a JWKS
 * network failure) propagate so the route can surface a 500.
 */
export async function verifyEntraIdToken(
  idToken: string,
  entra: EntraSsoSettings,
): Promise<EntraClaims> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new EntraAuthError('Malformed token');
  }

  const header = decoded.header as JwtHeader;
  // Pin RS256 to defend against algorithm-confusion (e.g. alg:none / HS256 with a public key).
  if (header.alg !== 'RS256') throw new EntraAuthError('Unexpected token algorithm');
  if (!header.kid) throw new EntraAuthError('Token missing key id');

  const signingKey = await jwksClientFor(entra.tenantId).getSigningKey(header.kid);
  const publicKey = signingKey.getPublicKey();

  let payload: JwtPayload;
  try {
    payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: entra.clientId,
      issuer: `${authority(entra.tenantId)}/v2.0`,
      clockTolerance: CLOCK_TOLERANCE_SEC,
    }) as JwtPayload;
  } catch {
    // Covers bad signature, wrong audience/issuer, expired, not-before, etc.
    throw new EntraAuthError('Token verification failed');
  }

  // jsonwebtoken does not check tenant; do it explicitly (essential if authority ever becomes /common).
  if (payload.tid !== entra.tenantId) throw new EntraAuthError('Token from an unexpected tenant');

  const oid = typeof payload.oid === 'string' ? payload.oid : '';
  if (!oid) throw new EntraAuthError('Token missing object id');

  const email =
    (typeof payload.email === 'string' && payload.email) ||
    (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
    '';
  if (!email) throw new EntraAuthError('Token missing email');

  const name = typeof payload.name === 'string' && payload.name ? payload.name : email;

  return { oid, email, name };
}

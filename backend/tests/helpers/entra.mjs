// Local stub Entra IdP for the SSO token tests: an RSA key pair, a minimal JWKS endpoint, and an
// ID-token minter. The backend under test is pointed at it via ENTRA_AUTHORITY_BASE (services/entra.ts),
// which parameterizes BOTH the JWKS fetch and the issuer check, so a locally minted RS256 token
// verifies exactly like a real Microsoft one.
import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export async function startFakeEntra() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-signing-key-1';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };

  // jwks-rsa fetches <authority(tenant)>/discovery/v2.0/keys — the tenant is in the path, so serving
  // the same JWKS on every path keeps the stub tenant-agnostic.
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  /**
   * Mint an ID token the way the fake IdP would. `claims` entries override the defaults; a `null`
   * value DELETES the claim (for the missing-oid/-email cases). issuer/audience/expiresIn/algorithm/
   * key/keyid can be overridden to break one verification dimension at a time.
   */
  function mintIdToken({
    tenantId, clientId,
    claims = {},
    issuer, audience, expiresIn = '5m',
    algorithm = 'RS256', key = privateKey, keyid = kid,
  }) {
    const payload = { tid: tenantId, oid: randomUUID(), email: 'sso.user@braingain.app', name: 'SSO User' };
    for (const [k, v] of Object.entries(claims)) {
      if (v === null) delete payload[k];
      else payload[k] = v;
    }
    return jwt.sign(payload, key, {
      algorithm,
      keyid,
      audience: audience ?? clientId,
      issuer: issuer ?? `${base}/${tenantId}/v2.0`,
      expiresIn,
    });
  }

  return {
    base,
    kid,
    mintIdToken,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

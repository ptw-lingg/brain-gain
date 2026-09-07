// Automated tests for the HTTPS/TLS certificate-management requirements:
//   SR-110  HTTPS-only delivery · SR-111 Admin-managed TLS certificate (key never exposed)
//   SYS-TLS-01 single HTTPS origin · SYS-TLS-04 metadata-only exposure ·
//   SYS-TLS-05 upload validates + hot-swaps · SYS-TLS-06 certificate endpoints admin-only ·
//   SYS-TLS-09 HSTS header
//   VT-110 served over HTTPS · VT-113 upload hot-swaps · VT-114 invalid/mismatched → 400 ·
//   VT-115 private key never exposed
//
// Runs against a freshly-seeded, isolated backend over HTTPS (see helpers/server.mjs; the test client
// sets NODE_TLS_REJECT_UNAUTHORIZED=0 to accept the auto-generated self-signed cert). Seeded fixtures:
//   admin@braingain.app / admin123   (admin)
//   user@braingain.app  / user123    (plain member — non-admin)
//
// Valid cert+key pairs are generated in-test with the `selfsigned` package (already a backend dep),
// exactly as backend/src/services/tls.ts does. A mismatched pair (cert from A + key from B) exercises
// the key-does-not-match-cert rejection path.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startTestServer } from './helpers/server.mjs';

// `selfsigned` is a CommonJS dependency of the backend; load it from the backend's node_modules.
const require = createRequire(import.meta.url);
const selfsigned = require('selfsigned');

/** Generate a fresh self-signed cert+key pair (same shape the backend uses). */
async function makePair(cn = 'localhost') {
  const pems = await selfsigned.generate([{ name: 'commonName', value: cn }], {
    keySize: 2048,
    algorithm: 'sha256',
  });
  return { cert: pems.cert, key: pems.private };
}

const PRIVATE_KEY_MARKERS = ['PRIVATE KEY', 'RSA PRIVATE KEY', 'BEGIN EC PRIVATE KEY'];

/** Assert a JSON value carries no private-key/cert PEM material anywhere in it. */
function assertNoKeyOrPem(value, where) {
  const blob = JSON.stringify(value ?? null);
  for (const marker of PRIVATE_KEY_MARKERS) {
    assert.ok(!blob.includes(marker), `${where}: must not contain a private key (${marker})`);
  }
  assert.ok(!blob.includes('BEGIN CERTIFICATE'), `${where}: must not contain the certificate PEM`);
  // The metadata field names that ARE allowed — guards against accidentally returning raw fields.
  assert.ok(!/"key"\s*:/.test(blob), `${where}: must not contain a "key" field`);
}

let srv;
let adminToken;
let memberToken;
let validPair; // { cert, key }

before(async () => {
  srv = await startTestServer();

  const adminLogin = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.equal(adminLogin.status, 200, 'admin can log in');
  adminToken = adminLogin.body.token;

  const memberLogin = await srv.request('POST', '/api/auth/login', {
    body: { email: 'user@braingain.app', password: 'user123' },
  });
  assert.equal(memberLogin.status, 200, 'member can log in');
  memberToken = memberLogin.body.token;

  validPair = await makePair();
});

after(async () => { await srv?.stop(); });

// ───────────────────────── SR-110 / SYS-TLS-01 / SYS-TLS-09 / VT-110 ─────────────────────────

test('SYS-TLS-01 / VT-110: the API is served over HTTPS (health responds over TLS)', async () => {
  assert.ok(srv.baseUrl.startsWith('https://'), 'the backend base URL is HTTPS');
  const res = await srv.request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true); // the payload also carries the app version (SYS-VER-02)
});

test('SYS-TLS-09 / SR-110: responses include an HSTS header (HTTPS-only origin)', async () => {
  // Use a raw fetch so we can read response headers (the helper only returns status+body).
  const res = await fetch(`${srv.baseUrl}/api/health`);
  const hsts = res.headers.get('strict-transport-security');
  assert.ok(hsts, 'Strict-Transport-Security header is present');
  assert.match(hsts, /max-age=\d+/, 'HSTS carries a max-age');
});

// ───────────────────── SR-111 / SYS-TLS-04 / SYS-TLS-06 / VT-115: metadata only, no key ─────────────────────

test('SYS-TLS-04 / VT-115: GET /api/settings exposes TLS metadata only — never the key or cert PEM', async () => {
  const res = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok('tls' in res.body, 'settings includes a tls field');
  assertNoKeyOrPem(res.body, 'GET /api/settings');
  // tls may be null until first written; if present it must be metadata-shaped only.
  if (res.body.tls) {
    for (const f of ['source', 'subject', 'issuer', 'validFrom', 'validTo', 'fingerprint']) {
      assert.ok(f in res.body.tls, `tls metadata has ${f}`);
    }
    assert.ok(!('key' in res.body.tls) && !('cert' in res.body.tls), 'tls metadata holds no key/cert');
  }
});

test('SYS-TLS-06 / VT-115: GET /api/settings/certificate returns metadata only (no private key)', async () => {
  const res = await srv.request('GET', '/api/settings/certificate', { token: adminToken });
  assert.equal(res.status, 200);
  // The backend auto-generated a self-signed cert in the temp data dir, so metadata is present.
  assert.ok(res.body, 'metadata for the active (auto-generated) certificate is returned');
  assert.equal(res.body.source, 'self-signed', 'bootstrap cert reports source=self-signed');
  for (const f of ['subject', 'issuer', 'validFrom', 'validTo', 'fingerprint']) {
    assert.ok(f in res.body, `metadata has ${f}`);
  }
  assertNoKeyOrPem(res.body, 'GET /api/settings/certificate');
});

// ───────────────────────── SYS-TLS-06 / VT-114-context: admin-only guards ─────────────────────────

test('SYS-TLS-06: GET /api/settings/certificate requires admin — member → 403', async () => {
  const res = await srv.request('GET', '/api/settings/certificate', { token: memberToken });
  assert.equal(res.status, 403);
});

test('SYS-TLS-06: POST /api/settings/certificate requires admin — member → 403', async () => {
  const res = await srv.request('POST', '/api/settings/certificate', {
    token: memberToken,
    body: { cert: validPair.cert, key: validPair.key },
  });
  assert.equal(res.status, 403, 'requireAdmin blocks a non-admin upload');
});

test('SYS-TLS-06: POST /api/settings/certificate with no token → 401', async () => {
  const res = await srv.request('POST', '/api/settings/certificate', {
    body: { cert: validPair.cert, key: validPair.key },
  });
  assert.equal(res.status, 401);
});

test('SYS-TLS-06: POST /api/settings/certificate/self-signed requires admin — member → 403', async () => {
  const res = await srv.request('POST', '/api/settings/certificate/self-signed', { token: memberToken });
  assert.equal(res.status, 403);
});

// ───────────────────────── SYS-TLS-05 / VT-114: validation / rejection paths ─────────────────────────

test('SYS-TLS-05 / VT-114: missing cert or key → 400', async () => {
  const noKey = await srv.request('POST', '/api/settings/certificate', {
    token: adminToken,
    body: { cert: validPair.cert },
  });
  assert.equal(noKey.status, 400);

  const noCert = await srv.request('POST', '/api/settings/certificate', {
    token: adminToken,
    body: { key: validPair.key },
  });
  assert.equal(noCert.status, 400);

  const empty = await srv.request('POST', '/api/settings/certificate', {
    token: adminToken,
    body: { cert: '   ', key: '   ' },
  });
  assert.equal(empty.status, 400, 'whitespace-only PEM is rejected');
});

test('SYS-TLS-05 / VT-114: malformed (non-PEM) cert+key → 400, active cert unchanged', async () => {
  const before = await srv.request('GET', '/api/settings/certificate', { token: adminToken });

  const res = await srv.request('POST', '/api/settings/certificate', {
    token: adminToken,
    body: { cert: 'not a real certificate', key: 'not a real key' },
  });
  assert.equal(res.status, 400, 'malformed PEM is rejected');
  assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0, 'a clear error message is returned');

  const after = await srv.request('GET', '/api/settings/certificate', { token: adminToken });
  assert.equal(after.body.fingerprint, before.body.fingerprint, 'active certificate is unchanged');
});

test('SYS-TLS-05 / VT-114: a private key that does not match the certificate → 400', async () => {
  // Two independent valid pairs: cert from A, key from B → well-formed PEM but mismatched.
  const pairA = await makePair('a.example.test');
  const pairB = await makePair('b.example.test');

  const before = await srv.request('GET', '/api/settings/certificate', { token: adminToken });

  const res = await srv.request('POST', '/api/settings/certificate', {
    token: adminToken,
    body: { cert: pairA.cert, key: pairB.key },
  });
  // Node's tls.createSecureContext rejects a mismatched key/cert pair itself (before the explicit
  // public-key comparison), so the message may be either the secure-context error or the explicit
  // "does not match" one — both are TlsError → HTTP 400. The requirement (VT-114) is the 400 + a
  // clear error and an unchanged active certificate.
  assert.equal(res.status, 400, 'key/cert mismatch is rejected');
  assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0, 'a clear error message is returned');

  const after = await srv.request('GET', '/api/settings/certificate', { token: adminToken });
  assert.equal(after.body.fingerprint, before.body.fingerprint, 'active certificate is unchanged after a rejected upload');
});

// ───────────────────────── SYS-TLS-05 / VT-113 + VT-115: accept a valid pair, still no key leak ─────────────────────────

test('SYS-TLS-05 / VT-113: a valid cert+key pair is accepted (200) and hot-swaps without restart', async () => {
  const res = await srv.request('POST', '/api/settings/certificate', {
    token: adminToken,
    body: { cert: validPair.cert, key: validPair.key },
  });
  assert.equal(res.status, 200, 'a valid self-signed pair is accepted');
  assert.equal(res.body.source, 'uploaded', 'metadata marks the cert as uploaded');
  for (const f of ['subject', 'issuer', 'validFrom', 'validTo', 'fingerprint']) {
    assert.ok(f in res.body, `returned metadata has ${f}`);
  }
  assertNoKeyOrPem(res.body, 'POST /api/settings/certificate response');

  // Server keeps serving over HTTPS after the hot-swap (no restart) — health still responds.
  const health = await srv.request('GET', '/api/health');
  assert.equal(health.status, 200, 'HTTPS server still serving after setSecureContext hot-swap');
});

test('SYS-TLS-04 / VT-115: after an upload, neither /settings nor /certificate ever returns the key', async () => {
  // Ensure the prior upload landed.
  const settings = await srv.request('GET', '/api/settings', { token: adminToken });
  assert.equal(settings.status, 200);
  assert.ok(settings.body.tls, 'tls metadata is now persisted in settings');
  assert.equal(settings.body.tls.source, 'uploaded');
  assertNoKeyOrPem(settings.body, 'GET /api/settings after upload');

  const certMeta = await srv.request('GET', '/api/settings/certificate', { token: adminToken });
  assert.equal(certMeta.body.source, 'uploaded', 'active cert reflects the uploaded one');
  assertNoKeyOrPem(certMeta.body, 'GET /api/settings/certificate after upload');
});

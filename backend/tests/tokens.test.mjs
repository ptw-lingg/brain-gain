// Token lifetime requirement.
//   SYS-AUTH-03 (derivedFrom SR-005 persistent session): the issued JWT is valid for 7 days.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, decodeJwt } from './helpers/server.mjs';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv?.stop(); });

test('SYS-AUTH-03 / SR-005: the login JWT carries iat/exp and expires exactly 7 days after issue', async () => {
  const r = await srv.request('POST', '/api/auth/login', {
    body: { email: 'admin@braingain.app', password: 'admin123' },
  });
  assert.equal(r.status, 200);
  const { iat, exp } = decodeJwt(r.body.token);
  assert.ok(Number.isInteger(iat) && Number.isInteger(exp), 'token carries integer iat and exp');
  assert.equal(exp - iat, 7 * 24 * 60 * 60, 'exp is 7 days (604800s) after iat');
});

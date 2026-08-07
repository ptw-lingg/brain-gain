// Spawns the real backend (via tsx) against an isolated, throwaway DATA_DIR so automated tests are
// deterministic and never touch real data. The temp dir auto-seeds demo data on first boot and the
// TLS service auto-generates its own self-signed cert there.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // accept the dev self-signed cert from the test client

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'); // tests/helpers → backend/

/** Decode a JWT payload (no verification — tests only inspect claims). */
export function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

/**
 * Boot a fresh backend with a temp data dir on a random free-ish port (so multiple test files —
 * and parallel agents — never collide). Pass an explicit httpsPort to pin it; pass `env` to add
 * process env vars for the backend (e.g. ENTRA_AUTHORITY_BASE for the SSO stub IdP). Retries on a
 * fresh port if the chosen one was taken. Returns { baseUrl, request, stop }.
 */
export async function startTestServer(opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const base = opts.httpsPort ?? 20000 + Math.floor(Math.random() * 40000);
    try {
      return await boot(base, base + 1, opts.env);
    } catch (err) {
      lastErr = err;
      if (opts.httpsPort) break; // caller pinned the port — don't reroll
    }
  }
  throw lastErr;
}

async function boot(httpsPort, httpPort, extraEnv = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'braingain-test-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HTTPS_PORT: String(httpsPort),
      HTTP_PORT: String(httpPort),
      JWT_SECRET: 'test-secret',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  // Set SHOW_SERVER_LOG=1 to echo the backend's own output while debugging a failing test.
  const echo = process.env.SHOW_SERVER_LOG ? (d) => process.stderr.write(`[server] ${d}`) : () => {};
  proc.stdout.on('data', (d) => { log += d; echo(d); });
  proc.stderr.on('data', (d) => { log += d; echo(d); });

  const baseUrl = `https://localhost:${httpsPort}`;
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`backend exited early (code ${proc.exitCode}):\n${log}`);
    try {
      const r = await fetch(`${baseUrl}/api/health`);
      if (r.ok) { ready = true; break; }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  if (!ready) {
    proc.kill();
    throw new Error(`backend did not become healthy within 30s:\n${log}`);
  }

  /** fetch wrapper: request(method, path, { token, body }) → { status, body }. */
  async function request(method, path, { token, body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  }

  async function stop() {
    proc.kill();
    try { await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(5000)]); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  return { baseUrl, dataDir, request, stop };
}

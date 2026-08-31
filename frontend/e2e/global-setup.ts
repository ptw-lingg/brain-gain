import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Ports for the isolated e2e backend (distinct from dev :3001 and the test harness :3990).
const HTTPS_PORT = 4443;
const HTTP_PORT = 4442;
// The SCORM content origin — a SECOND https listener; the origin split is what the isolation
// specs actually verify, so it must be a real separate origin here too.
const SCORM_PORT = 4444;

export default async function globalSetup(): Promise<void> {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // accept the self-signed cert from Node-side fetches
  const frontendRoot = process.cwd();
  const backendRoot = resolve(frontendRoot, '..', 'backend');
  const stateFile = join(frontendRoot, 'e2e', '.server-state.json');

  // The backend serves the SPA from frontend/dist.
  console.log('[e2e] building the SPA…');
  execSync('npx vite build', { cwd: frontendRoot, stdio: 'inherit' });

  const dataDir = mkdtempSync(join(tmpdir(), 'bg-e2e-'));
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      HTTPS_PORT: String(HTTPS_PORT),
      HTTP_PORT: String(HTTP_PORT),
      SCORM_CONTENT_PORT: String(SCORM_PORT),
      // The SPA is served by express here, so the app origin is the backend itself — this is the
      // environment where the real production CSP gets exercised end to end. Enforce it.
      APP_ORIGIN: `https://localhost:${HTTPS_PORT}`,
      CSP_ENFORCE: '1',
      JWT_SECRET: 'e2e-secret',
    },
    stdio: 'pipe',
  });
  let log = '';
  proc.stdout?.on('data', (d) => (log += d));
  proc.stderr?.on('data', (d) => (log += d));

  const base = `https://localhost:${HTTPS_PORT}`;
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`[e2e] backend exited early (code ${proc.exitCode}):\n${log}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) { ready = true; break; }
    } catch { /* not up yet */ }
    await sleep(300);
  }
  if (!ready) { proc.kill(); throw new Error(`[e2e] backend not ready within 60s:\n${log}`); }

  writeFileSync(stateFile, JSON.stringify({ pid: proc.pid, dataDir }));
  console.log(`[e2e] backend ready at ${base} (data dir: ${dataDir})`);
}

import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export default async function globalTeardown(): Promise<void> {
  const stateFile = join(process.cwd(), 'e2e', '.server-state.json');
  if (!existsSync(stateFile)) return;
  const { pid, dataDir } = JSON.parse(readFileSync(stateFile, 'utf8')) as { pid: number; dataDir: string };
  try { process.kill(pid); } catch { /* already gone */ }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(stateFile); } catch { /* ignore */ }
}

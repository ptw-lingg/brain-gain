// Automatic scheduled backups (SYS-BAK-10).
//
// Mechanism: an hourly check with boot catch-up rather than a cron-style alarm. At boot (after the
// data migrations) and then every hour, if automation is enabled and the newest AUTOMATIC backup is
// older than Settings.autoBackup.intervalDays — or none exists — a backup with source 'auto' is
// created. A run the server slept through is therefore made up at the next start, and the check is
// cheap enough that the hourly cadence costs nothing when nothing is due.
//
// Retention applies to AUTOMATIC backups only: after each automatic backup the oldest 'auto'
// archives beyond Settings.autoBackup.keep are deleted. Manual, uploaded and pre-restore backups
// are NEVER touched — an admin's deliberate snapshots must not age out.

import { readSettings } from './fileStore';
import { createBackup, deleteBackup, listBackups } from './backup';
import { auditEvent } from './audit';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Re-entrancy guard: the boot catch-up and an hourly tick (or two slow ticks) must never create two
// backups at once. createBackup is already serialized against restores by backup.ts's exclusive()
// queue, so this guard only prevents duplicate due-checks, not data races.
let running = false;

/** One due-check: create an automatic backup if the newest one is overdue, then prune the surplus. */
export async function runAutoBackupIfDue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { autoBackup } = await readSettings();
    if (!autoBackup.enabled) return;

    const newestAuto = (await listBackups()).find((b) => b.source === 'auto'); // list is newest first
    const due =
      !newestAuto ||
      Date.now() - new Date(newestAuto.createdAt).getTime() >= autoBackup.intervalDays * DAY_MS;
    if (!due) return;

    const meta = await createBackup('auto');
    console.log(`↪  automatic backup created: ${meta.fileName} (${meta.size} bytes)`);
    // Actor-less: the scheduler acted, not a user.
    await auditEvent(null, 'backup-create', { type: 'backup', id: meta.id, name: meta.fileName }, { details: 'automatic' });

    // Retention: keep the newest `keep` automatic backups, delete the older surplus. Filtering on
    // source==='auto' is what keeps every other source out of reach.
    const keep = Math.max(1, autoBackup.keep);
    const autos = (await listBackups()).filter((b) => b.source === 'auto');
    for (const surplus of autos.slice(keep)) {
      await deleteBackup(surplus.id);
      console.log(`↪  automatic backup pruned (keeping ${keep}): ${surplus.fileName}`);
    }
  } finally {
    running = false;
  }
}

/**
 * Start the scheduler: an immediate catch-up run plus an hourly re-check. Fire-and-forget with a
 * catch-log so boot is never slowed or crashed by a failing backup; the timer is unref()ed so it
 * never holds a test process or shutdown open.
 */
export function startAutoBackupScheduler(): void {
  const tick = (): void => {
    runAutoBackupIfDue().catch((err) => console.error('Automatic backup failed:', err));
  };
  tick(); // boot catch-up
  setInterval(tick, HOUR_MS).unref();
}

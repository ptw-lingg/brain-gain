// The one place that knows every data migration and their order. Runs at boot (after seeding) and
// again after a backup restore — a restored archive may carry records in any historical shape, and
// restore must not wait for the next reboot to normalize them.
//
// Two mechanisms, in this order:
//   1. NORMALIZE — the unconditional, idempotent shape-sniffers below. Each re-detects a legacy shape
//      per record and is a no-op otherwise; they run on every boot whatever the data version says
//      (migrateOrgUnits also BOOTSTRAPS the root unit, and gcScorm is a sweep — both belong on every
//      boot and after every restore).
//   2. MIGRATE — the version-gated steps in migrationSteps/, applied once each when the marker's
//      dataVersion < step.version <= appVersion, after a pre-migration backup. See dataVersion.ts for
//      the marker and migrationSteps/index.ts for the step contract.

import { migrateOrgUnits } from './orgUnits';
import { migrateQuestions } from './questions';
import { migrateDurations, migrateMaterials, migrateTrainingTexts } from './materials';
import { migrateTrainingVersions, pruneUpdateAcks } from './updates';
import { gcScorm } from './scorm/packages';
import { migrateScormThumbnails } from './scorm/thumbnail';
import { appVersion, BASELINE_DATA_VERSION, compareVersions } from './appVersion';
import { DataVersionError, readDataMeta, stampDataVersion } from './dataVersion';
import { MIGRATION_STEPS, type MigrationResult } from './migrationSteps';
import { createBackup } from './backup';
import { auditEvent } from './audit';

export interface RunDataMigrationsOptions {
  /**
   * Take a 'pre-migration' backup before the first gated step (default true). The restore path passes
   * false: its pre-restore snapshot is already the recovery point — and createBackup() must never run
   * inside backup.ts's exclusive() queue (self-deadlock), which the restore route avoids only because
   * it calls this AFTER restoreBackup() has resolved.
   */
  preMigrationBackup?: boolean;
}

export async function runDataMigrations(opts: RunDataMigrationsOptions = {}): Promise<void> {
  // ── 1. normalize ─────────────────────────────────────────────────────────────────────────────────
  await migrateOrgUnits();
  await migrateQuestions();
  await migrateMaterials();
  await migrateDurations();
  await migrateTrainingTexts();
  await migrateTrainingVersions();
  await pruneUpdateAcks();
  // Packages imported before the cover-candidate field existed get scanned on disk once.
  await migrateScormThumbnails();
  // Not a migration in the strict sense, but the same trigger points are exactly right: boot, and
  // after a restore (which can drop the training a package/attempt belonged to). Sweeps
  // unreferenced packages, crashed-import directories and stale attempts; never touches consumed
  // attempts (completion evidence).
  await gcScorm();

  // ── 2. gate ──────────────────────────────────────────────────────────────────────────────────────
  const app = appVersion();
  // No marker here means a restore/boot path that could not write one — treat as pre-versioning data.
  const stored = (await readDataMeta())?.dataVersion ?? BASELINE_DATA_VERSION;
  const cmp = compareVersions(stored, app);
  if (cmp > 0) {
    if (!process.env.ALLOW_DATA_DOWNGRADE) throw new DataVersionError(stored, app);
    console.warn(
      `⚠  ALLOW_DATA_DOWNGRADE: running app ${app} on data written by ${stored}. Fields this build does not know may be dropped on the next write.`,
    );
    return; // never move the marker downward
  }
  const pending = MIGRATION_STEPS.filter(
    (s) => compareVersions(stored, s.version) < 0 && compareVersions(s.version, app) <= 0,
  );
  if (!pending.length) {
    // A version bump without a data change: advance the marker, write nothing else, take no backup.
    if (cmp < 0) await stampDataVersion(app, 'upgraded', { note: 'no migration step was due' });
    return;
  }

  // ── 3. recovery point — decided by the version gap BEFORE anything runs, never by outcome ────────
  if (opts.preMigrationBackup !== false) {
    const meta = await createBackup('pre-migration');
    console.log(`↪  pre-migration backup created: ${meta.fileName} (${meta.size} bytes)`);
  }

  // ── 4. apply, advancing the marker after EACH step ───────────────────────────────────────────────
  const applied: string[] = [];
  for (const step of pending) {
    console.log(`↪  migrating data to ${step.version}: ${step.description}`);
    let result: MigrationResult;
    try {
      result = await step.up();
    } catch (err: unknown) {
      // The marker stays at the previous step, so this step runs again at the next boot; index.ts
      // turns the rethrow into exit 1 — no listener binds on half-migrated data.
      await auditEvent(
        null,
        'data-migration-failed',
        { type: 'system', name: `${stored} → ${app}` },
        { details: `step ${step.version} (${step.description}): ${(err as Error).message}` },
      );
      throw err;
    }
    await stampDataVersion(step.version, 'migrated', { changed: result.changed, note: result.details ?? step.description });
    console.log(`   ${result.changed ? 'changed' : 'no change'}${result.details ? ` — ${result.details}` : ''}`);
    applied.push(`${step.version}${result.changed ? '' : ' (no change)'}`);
  }
  if (compareVersions(pending[pending.length - 1].version, app) < 0) await stampDataVersion(app, 'upgraded');
  // Actor-less: the server upgraded itself. The audit log survives restores, so this evidence outlives
  // the data it describes.
  await auditEvent(null, 'data-migrated', { type: 'system', name: `${stored} → ${app}` }, { details: `steps: ${applied.join(', ')}` });
}

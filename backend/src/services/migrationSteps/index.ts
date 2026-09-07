// The registry of VERSION-GATED data migrations — the counterpart of the unconditional
// shape-normalizing pass in ../migrations.ts. Two kinds of change, two mechanisms:
//
//   Normalize (migrations.ts) — idempotent, structural, legacy→current. Re-detects a legacy shape per
//     record and runs on EVERY boot. Right for additive changes a record can be inspected for.
//   Migrate (this registry) — gated by the data version, runs ONCE, may destroy information, and may
//     not be inferable from the shape at all (a removed field, a re-interpreted unit). Right for
//     anything that must not repeat on a downgrade or cannot be told apart from current data.
//
// One step per version; two transforms shipped in one release share one up(). Steps are validated and
// sorted at module load — a malformed registry is a developer error and must be loud.
//
// CONTRACT: up() MUST be idempotent and re-runnable. The runner advances the marker after each step,
// so a throw or a crash mid-step leaves partial writes and the same step runs again at the next boot.

import { appVersion, compareVersions, isValidVersion } from '../appVersion';
import { pruneSettingsKeys } from './1.3.0-prune-settings-keys';

export interface MigrationResult {
  changed: boolean; // evidence only — the pre-migration backup is decided by the version gap, not by this
  details?: string; // one line for the boot log and the marker history
}

export interface MigrationStep {
  /** The app version that introduced this step. Strict MAJOR.MINOR.PATCH; at most one step per version. */
  version: string;
  /** One line — goes into the boot log, the marker history and the audit trail. */
  description: string;
  /** MUST be idempotent and re-runnable (see the file header). */
  up(): Promise<MigrationResult>;
}

// Register new steps here, one per released version. The /release skill scaffolds the file.
const registered: MigrationStep[] = [pruneSettingsKeys];

function validated(steps: MigrationStep[]): MigrationStep[] {
  const seen = new Set<string>();
  for (const s of steps) {
    if (!isValidVersion(s.version)) {
      throw new Error(`migration step "${s.description}" has a non-MAJOR.MINOR.PATCH version: ${s.version}`);
    }
    if (seen.has(s.version)) {
      throw new Error(`two migration steps are registered for version ${s.version} — merge them into one up()`);
    }
    seen.add(s.version);
  }
  return [...steps].sort((a, b) => compareVersions(a.version, b.version));
}

export const MIGRATION_STEPS: readonly MigrationStep[] = validated(registered);

// A step ahead of the app is legitimate while a release is being prepared (the step is usually written
// before VERSION is bumped) — but it will not run until the bump, so say so rather than throw.
for (const s of MIGRATION_STEPS) {
  if (compareVersions(s.version, appVersion()) > 0) {
    console.warn(
      `⚠  migration step ${s.version} (${s.description}) targets a future version — it runs after the next VERSION bump`,
    );
  }
}

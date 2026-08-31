// The one place that knows every data migration and their order. Runs at boot (after seeding) and
// again after a backup restore — a restored archive may carry records in any historical shape, and
// restore must not wait for the next reboot to normalize them.

import { migrateOrgUnits } from './orgUnits';
import { migrateQuestions } from './questions';
import { migrateDurations, migrateMaterials, migrateTrainingTexts } from './materials';
import { migrateTrainingVersions, pruneUpdateAcks } from './updates';
import { gcScorm } from './scorm/packages';

export async function runDataMigrations(): Promise<void> {
  await migrateOrgUnits();
  await migrateQuestions();
  await migrateMaterials();
  await migrateDurations();
  await migrateTrainingTexts();
  await migrateTrainingVersions();
  await pruneUpdateAcks();
  // Not a migration in the strict sense, but the same trigger points are exactly right: boot, and
  // after a restore (which can drop the training a package/attempt belonged to). Sweeps
  // unreferenced packages, crashed-import directories and stale attempts; never touches consumed
  // attempts (completion evidence).
  await gcScorm();
}

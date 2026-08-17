// The one place that knows every data migration and their order. Runs at boot (after seeding) and
// again after a backup restore — a restored archive may carry records in any historical shape, and
// restore must not wait for the next reboot to normalize them.

import { migrateOrgUnits } from './orgUnits';
import { migrateQuestions } from './questions';
import { migrateDurations, migrateMaterials, migrateTrainingTexts } from './materials';
import { migrateTrainingVersions, pruneUpdateAcks } from './updates';

export async function runDataMigrations(): Promise<void> {
  await migrateOrgUnits();
  await migrateQuestions();
  await migrateMaterials();
  await migrateDurations();
  await migrateTrainingTexts();
  await migrateTrainingVersions();
  await pruneUpdateAcks();
}

// 1.3.0 — settings.json: drop top-level keys that are no longer part of the Settings shape.
//
// Why a gated step and not a normalizer: readSettings() spreads the stored object over the defaults and
// routes/settings.ts spreads the previous settings into the next, so a key removed from the type (the
// admin-configurable `materialLocales` list, replaced by the fixed MATERIAL_LOCALES constant) survives
// every save forever. Dropping it is destructive — a downgrade would lose the value — which is exactly
// what must not repeat on every boot.

import type { Settings } from '../../types';
import { DEFAULT_SETTINGS, readSettings, writeSettings } from '../fileStore';
import type { MigrationStep } from './index';

export const pruneSettingsKeys: MigrationStep = {
  version: '1.3.0',
  description: 'settings.json: drop keys that are no longer part of Settings (e.g. the removed materialLocales)',
  async up() {
    // readSettings keeps unknown stored keys (the spread copies them), so they are visible here.
    const stored = (await readSettings()) as Settings & Record<string, unknown>;
    const known = new Set(Object.keys(DEFAULT_SETTINGS));
    const stale = Object.keys(stored).filter((k) => !known.has(k));
    if (!stale.length) return { changed: false, details: 'no unknown keys in settings.json' };

    const next = Object.fromEntries(Object.entries(stored).filter(([k]) => known.has(k))) as unknown as Settings;
    await writeSettings(next);
    return { changed: true, details: `pruned ${stale.join(', ')} from settings.json` };
  },
};

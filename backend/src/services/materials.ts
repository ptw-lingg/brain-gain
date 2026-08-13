// Learning-material helpers: sanitizing the localized materials that arrive from a client,
// enumerating the uploaded file ids a training references (for byte cleanup), and migrating the
// legacy flat materialLinks/materialFiles shape.
//
// A material is a GROUP of per-locale variants; each variant carries its own label and its own
// content — a web link or an uploaded file. Sanitization enforces the invariants: every variant's
// locale is one of Settings.materialLocales, a variant holds exactly one kind of content (the file
// wins when both arrive), at most one variant per locale, and a material keeps at least one
// content-bearing variant or is dropped entirely — the silent-normalizer idiom used everywhere on
// this write path.

import { randomUUID } from 'crypto';
import type { Material, MaterialFile, MaterialVariant, Training } from '../types';
import { readStore, writeStore } from './fileStore';
import { UUID_RE } from '../routes/http';

// Material-file descriptors come from the client (it uploads bytes first via POST /materials, then
// sends the returned descriptors back on save). Keep only descriptors whose id is a well-formed
// UUID — the shape the upload endpoint issues — and coerce the remaining fields. A descriptor
// pointing at a non-existent id simply yields a 404 on download, never a path-traversal read.
function sanitizeFile(input: unknown): MaterialFile | undefined {
  const obj = (input ?? {}) as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !UUID_RE.test(obj.id)) return undefined;
  const size = Number(obj.size);
  return {
    id: obj.id,
    name: typeof obj.name === 'string' ? obj.name : 'file',
    size: Number.isFinite(size) && size >= 0 ? Math.round(size) : 0,
    type: typeof obj.type === 'string' ? obj.type : '',
  };
}

export function sanitizeMaterials(input: unknown, allowedLocales: readonly string[]): Material[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m): Material | null => {
      const obj = (m ?? {}) as Record<string, unknown>;
      const rawVariants = Array.isArray(obj.variants) ? obj.variants : [];
      const byLocale = new Map<string, MaterialVariant>();
      for (const raw of rawVariants) {
        const v = (raw ?? {}) as Record<string, unknown>;
        const locale = typeof v.locale === 'string' ? v.locale : '';
        // Unknown locales are dropped, and the first variant per locale wins.
        if (!allowedLocales.includes(locale) || byLocale.has(locale)) continue;
        const label = typeof v.label === 'string' ? v.label.trim() : '';
        const file = sanitizeFile(v.file);
        const url = typeof v.url === 'string' ? v.url.trim() : '';
        if (file) {
          // A file is the stronger content claim — bytes already live on the server — so it wins
          // over a url; an unlabeled file variant is named after the file.
          byLocale.set(locale, { locale, label: label || file.name, file });
        } else if (url) {
          byLocale.set(locale, { locale, label, url });
        }
        // Neither file nor url → the variant is empty and silently dropped.
      }
      if (byLocale.size === 0) return null; // a material must keep at least one variant
      // Deterministic variant order: the settings list's order.
      const variants = allowedLocales
        .filter((locale) => byLocale.has(locale))
        .map((locale) => byLocale.get(locale)!);
      return {
        id: typeof obj.id === 'string' && obj.id ? obj.id : randomUUID(),
        variants,
      };
    })
    .filter((m): m is Material => m !== null);
}

/** Every uploaded-file id a training references — the enumeration for byte cleanup. */
export function materialFileIds(t: Pick<Training, 'materials'>): string[] {
  return (t.materials ?? []).flatMap((m) =>
    m.variants.flatMap((v) => (v.file ? [v.file.id] : [])),
  );
}

/**
 * One-time migration of stored trainings from the flat pre-locale shape
 * (`materialLinks: {label,url}[]` + `materialFiles: MaterialFile[]`) to localized `materials`:
 * every legacy entry becomes its own material with a single ENGLISH variant. Runs at boot next to
 * the other data migrations and again after a backup restore; a no-op once every training carries
 * `materials`, so it is safe to run repeatedly.
 */
/**
 * One-time migration of the training duration from HOURS to MINUTES: a record still carrying
 * `durationHours` gets `durationMinutes = round(hours * 60)` and loses the legacy field. Runs with
 * the other data migrations (boot + after a backup restore); a no-op once every record is converted.
 */
export async function migrateDurations(): Promise<void> {
  const trainings = await readStore<Training>('trainings');
  let migrated = 0;

  for (const training of trainings) {
    const legacy = training as Training & { durationHours?: number };
    if (typeof legacy.durationMinutes === 'number' && !('durationHours' in legacy)) continue;
    if (typeof legacy.durationMinutes !== 'number') {
      legacy.durationMinutes = Math.max(0, Math.round((Number(legacy.durationHours) || 0) * 60));
    }
    delete legacy.durationHours;
    migrated += 1;
  }

  if (!migrated) return;
  await writeStore('trainings', trainings);
  console.log(`↪  migrated ${migrated} training duration(s) from hours to minutes`);
}

export async function migrateMaterials(): Promise<void> {
  const trainings = await readStore<Training>('trainings');
  let migrated = 0;

  for (const training of trainings) {
    const legacy = training as Training & {
      materialLinks?: { label?: unknown; url?: unknown }[];
      materialFiles?: unknown[];
    };
    const hasLegacyFields = 'materialLinks' in legacy || 'materialFiles' in legacy;
    if (Array.isArray(legacy.materials) && !hasLegacyFields) continue;

    const materials: Material[] = Array.isArray(legacy.materials) ? legacy.materials : [];
    for (const link of legacy.materialLinks ?? []) {
      const label = typeof link?.label === 'string' ? link.label.trim() : '';
      const url = typeof link?.url === 'string' ? link.url.trim() : '';
      if (!label && !url) continue; // fully empty legacy rows carry nothing worth keeping
      materials.push({ id: randomUUID(), variants: [{ locale: 'en', label, url }] });
    }
    for (const raw of legacy.materialFiles ?? []) {
      const file = sanitizeFile(raw);
      if (!file) continue;
      materials.push({ id: randomUUID(), variants: [{ locale: 'en', label: file.name, file }] });
    }
    legacy.materials = materials;
    delete legacy.materialLinks;
    delete legacy.materialFiles;
    migrated += 1;
  }

  // Only write when something changed, so a normal boot doesn't rewrite the store.
  if (!migrated) return;
  await writeStore('trainings', trainings);
  console.log(`↪  migrated ${migrated} training(s) to localized materials`);
}

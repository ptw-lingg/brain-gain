// The catalog of languages an admin may add to Settings.materialLocales, plus display helpers.
// Maintained as a hand-mirrored copy of backend/src/services/locales.ts — keep the two in sync (the
// same convention as the shared domain types).
//
// `flag` is the flag-icons country code, which is NOT always the language code (cs→cz, sv→se,
// da→dk, zh→cn, ja→jp, ko→kr) — and English deliberately uses the US flag. Map only via this
// catalog, never derive a flag from a language code.

import type { LocalizedText } from '@/types';

export const MATERIAL_LOCALE_CATALOG = [
  { code: 'en', name: 'English', flag: 'us' },
  { code: 'de', name: 'Deutsch', flag: 'de' },
] as const;

/** The fixed content languages — English and German, for material and quiz texts alike. */
export const MATERIAL_LOCALES = ['en', 'de'] as const;

/** English is always present in Settings.materialLocales and is the per-material fallback. */
export const FALLBACK_LOCALE = 'en';

export function localeName(code: string): string {
  return MATERIAL_LOCALE_CATALOG.find((l) => l.code === code)?.name ?? code;
}

/**
 * Resolve a per-language string for display — the material fallback logic applied per string:
 * the chosen language's value, else the English one, else every filled value joined with ' / '
 * (so nothing localized is ever unreadable). `alternative` is true whenever the value shown is
 * not in the chosen language — it drives the session page's "alternative language" badge; every
 * other view resolves without a badge.
 */
export function resolveLocalized(
  lt: LocalizedText | undefined,
  locale: string,
): { value: string; alternative: boolean } {
  const map = lt ?? {};
  const chosen = map[locale];
  if (chosen) return { value: chosen, alternative: false };
  const fallback = map[FALLBACK_LOCALE];
  if (fallback) return { value: fallback, alternative: true };
  return { value: Object.values(map).filter(Boolean).join(' / '), alternative: true };
}

/** flag-icons CSS classes for a language code; unknown codes fall back to their own code. */
export function flagClass(code: string): string {
  const flag = MATERIAL_LOCALE_CATALOG.find((l) => l.code === code)?.flag ?? code;
  return `fi fi-${flag}`;
}

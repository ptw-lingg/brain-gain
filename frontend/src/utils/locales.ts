// The catalog of languages an admin may add to Settings.materialLocales, plus display helpers.
// Maintained as a hand-mirrored copy of backend/src/services/locales.ts — keep the two in sync (the
// same convention as the shared domain types).
//
// `flag` is the flag-icons country code, which is NOT always the language code (cs→cz, sv→se,
// da→dk, zh→cn, ja→jp, ko→kr) — and English deliberately uses the US flag. Map only via this
// catalog, never derive a flag from a language code.

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

/** flag-icons CSS classes for a language code; unknown codes fall back to their own code. */
export function flagClass(code: string): string {
  const flag = MATERIAL_LOCALE_CATALOG.find((l) => l.code === code)?.flag ?? code;
  return `fi fi-${flag}`;
}

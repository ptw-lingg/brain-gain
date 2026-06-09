import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import de from './locales/de.json';

export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code'];

const STORAGE_KEY = 'braingain.locale';

function detectLocale(): LocaleCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.some((l) => l.code === stored)) {
    return stored as LocaleCode;
  }
  const browser = navigator.language.slice(0, 2).toLowerCase();
  if (SUPPORTED_LOCALES.some((l) => l.code === browser)) {
    return browser as LocaleCode;
  }
  return 'en';
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { en, de },
});

/** Reflect the active locale in <html lang> and the document title. */
function applyLocaleToDocument(locale: LocaleCode): void {
  document.documentElement.setAttribute('lang', locale);
  document.title = `${i18n.global.t('common.appName')} — ${i18n.global.t('common.tagline')}`;
}

/** Switch the active locale and persist the choice. */
export function setLocale(locale: LocaleCode): void {
  i18n.global.locale.value = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  applyLocaleToDocument(locale);
}

/** Translate outside of a component setup context (stores, utils, router). */
export function t(key: string, named?: Record<string, unknown>): string {
  return i18n.global.t(key, named ?? {});
}

applyLocaleToDocument(i18n.global.locale.value);

/**
 * i18n bootstrap (Phase F.6). Languages: English (default), Spanish, French.
 * Translations live in `./locales/<lng>.json` and are imported eagerly so
 * the bundle ships fully-localized strings — no runtime fetch.
 *
 * Locale auto-detection order:
 *   1. localStorage 'cafe-pos.locale' (set by the LanguageSwitcher)
 *   2. browser `navigator.language`
 *   3. fallback 'en'
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';

export const SUPPORTED_LOCALES = ['en', 'es', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'cafe-pos.locale',
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export default i18n;

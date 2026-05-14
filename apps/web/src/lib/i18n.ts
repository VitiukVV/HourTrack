import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import uk from '@/locales/uk.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';

export const SUPPORTED_LANGUAGES = ['uk', 'en', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'hourtrack:lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      uk: { translation: uk },
      en: { translation: en },
      es: { translation: es },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false, // React handles XSS escaping
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    returnNull: false,
  });

// Keep <html lang> in sync with the active language so screen readers,
// browser translation prompts, and :lang() CSS selectors behave correctly.
if (typeof document !== 'undefined') {
  const syncHtmlLang = () => {
    document.documentElement.lang = (i18n.resolvedLanguage ?? 'en').split('-')[0] ?? 'en';
  };
  syncHtmlLang();
  i18n.on('languageChanged', syncHtmlLang);
}

export default i18n;

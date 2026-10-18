import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';

export const SUPPORTED_LANGUAGES = ['uk', 'en', 'es'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'hourtrack:lang';

/**
 * S23 — locale bundles are now lazy-loaded via dynamic `import()` instead of
 * three static `import uk from '@/locales/uk.json'` statements. Vite emits
 * one chunk per locale JSON so a cold load of `/` only fetches the active
 * language. The static-import shape used to keep the main bundle ~70-90 KB
 * heavier than necessary (three locales, ~25-30 KB each before gzip).
 *
 * Resolver: `i18next-resources-to-backend` adapts the dynamic-import
 * promise into i18next's pluggable backend interface. The function below
 * receives `(language, namespace)` from i18next and returns a Promise<{ ... }>
 * keyed by the namespace. We use a single `'translation'` namespace
 * matching the previous static shape.
 *
 * IMPORTANT — first-render race. With static imports, the locale strings
 * were guaranteed present on first render. With dynamic imports, calls to
 * `t('common.loading')` BEFORE the load resolves return the literal key
 * string. To avoid a flash of key strings on cold start, `main.tsx` MUST
 * await `loadInitialLocale()` before invoking `createRoot(...).render(...)`.
 */

// `as const` keys are TS-only; Vite needs the dynamic import to be a normal
// string template so it can statically discover the matching files at
// build time. The result of the import is `{ default: <json shape> }`.
const localeLoader = resourcesToBackend(async (language: string, _namespace: string) => {
  switch (language) {
    case 'uk':
      return (await import('@/locales/uk.json')).default;
    case 'en':
      return (await import('@/locales/en.json')).default;
    case 'es':
      return (await import('@/locales/es.json')).default;
    default:
      // Falls through to i18next's fallback chain (→ `fallbackLng: 'en'`).
      // Throw rather than return an empty object: a wrong language tag is a
      // configuration bug and an empty bundle would silently render keys
      // forever.
      throw new Error(`[i18n] Unsupported language: ${language}`);
  }
});

void i18n
  .use(LanguageDetector)
  .use(localeLoader)
  .use(initReactI18next)
  .init({
    // S23: no `resources` block — i18next pulls bundles via `localeLoader`
    // on demand. `partialBundledLanguages: true` is set so a synchronous
    // `t()` call before the load resolves doesn't crash; instead it returns
    // the key string until the bundle arrives.
    partialBundledLanguages: true,
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

/**
 * Await the initial locale's resources so the first render finds populated
 * translations. Call from `main.tsx` before `createRoot(...).render(...)`:
 *
 *   await loadInitialLocale();
 *   createRoot(rootEl).render(<App />);
 *
 * Without this, a cold load of `/` paints a brief frame of literal keys
 * (e.g. "common.loading" instead of "Завантаження...") before i18next's
 * async load resolves and triggers a re-render.
 *
 * Safe to await multiple times — i18next caches loaded namespaces.
 */
export async function loadInitialLocale(): Promise<void> {
  // `loadNamespaces` resolves once the resource for the currently-resolved
  // language is in i18next's store. We use the default `translation`
  // namespace.
  await i18n.loadNamespaces('translation');
}

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

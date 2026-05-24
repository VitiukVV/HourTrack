import { describe, it, expect } from 'vitest';

import uk from '@/locales/uk.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';

import i18n, { loadInitialLocale, SUPPORTED_LANGUAGES } from './i18n';

function flatten(obj: Record<string, unknown>, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flatten(v as Record<string, unknown>, key)) out.add(nested);
    } else {
      out.add(key);
    }
  }
  return out;
}

describe('i18n locale parity', () => {
  const ukKeys = flatten(uk as Record<string, unknown>);
  const enKeys = flatten(en as Record<string, unknown>);
  const esKeys = flatten(es as Record<string, unknown>);

  it('uk and en have identical key sets', () => {
    expect([...ukKeys].sort()).toEqual([...enKeys].sort());
  });

  it('en and es have identical key sets', () => {
    expect([...enKeys].sort()).toEqual([...esKeys].sort());
  });

  it('includes required core keys', () => {
    for (const key of [
      'app.title',
      'nav.calendar',
      'nav.reports',
      'nav.settings',
      'common.today',
    ]) {
      expect(enKeys.has(key)).toBe(true);
      expect(ukKeys.has(key)).toBe(true);
      expect(esKeys.has(key)).toBe(true);
    }
  });
});

/**
 * S23 — locale resources are now lazy-loaded via dynamic `import('...')`.
 * `loadInitialLocale()` must resolve before first render so translations are
 * populated and the UI doesn't briefly paint literal keys.
 */
describe('i18n lazy resources (S23)', () => {
  it('SUPPORTED_LANGUAGES still exposes the three locales', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['uk', 'en', 'es']);
  });

  it('loadInitialLocale() resolves and surfaces translations for the active language', async () => {
    // i18next-resources-to-backend has already wired the loader during
    // module init; awaiting `loadInitialLocale` flushes the in-flight
    // promise so subsequent `t()` calls see real strings.
    await loadInitialLocale();

    // `app.title` exists in all three locales; whichever the language
    // detector resolved, the value must not be the literal key.
    const title = i18n.t('app.title');
    expect(title).toBeTruthy();
    expect(title).not.toBe('app.title');
  });

  it('switching languages dynamically loads the new locale', async () => {
    // Sanity: a switch to 'es' must end with a translation that's not the
    // raw key. (Internally i18next loads the chunk via the backend
    // resolver; this exercises that the named export survives the dynamic
    // import boundary.)
    await i18n.changeLanguage('es');
    expect(i18n.resolvedLanguage).toBe('es');
    const t = i18n.t('app.title');
    expect(t).not.toBe('app.title');
    expect(t).toBeTruthy();

    // Switch back to 'uk' so subsequent test files start at the canonical
    // default (App.test.tsx + LanguageSwitcher tests expect a uk baseline).
    await i18n.changeLanguage('uk');
  });
});

import { describe, expect, it } from 'vitest';

import uk from '@/locales/uk.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';

/**
 * Plural forms for every `{{count}}` string.
 *
 * Both count-interpolating keys used to carry a SINGLE form, so Ukrainian read
 * «1 записів» / «1 сеансів» — the plural bug that only shows up on the exact
 * number the developer never tried. The test walks the bundles instead of
 * listing cases, so a count key added later is covered the moment it lands.
 *
 * Ported from my-diary's `src/lib/i18n.plurals.test.ts`.
 */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function flatten(value: Json, prefix = '', out = new Map<string, string>()): Map<string, string> {
  // Changelog / guide arrays carry no counts.
  if (Array.isArray(value)) return out;
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  if (typeof value === 'string') out.set(prefix, value);
  return out;
}

const BUNDLES = {
  uk: flatten(uk as Json),
  en: flatten(en as Json),
  es: flatten(es as Json),
};

const LANGS = ['uk', 'en', 'es'] as const;
type Lang = (typeof LANGS)[number];

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Suffixes each language actually resolves, per `Intl.PluralRules`. */
const SUFFIXES: Record<Lang, string[]> = {
  uk: ['one', 'few', 'many', 'other'],
  en: ['one', 'other'],
  es: ['one', 'other'],
};

/** Base keys whose value interpolates `{{count}}`, in any locale. */
const COUNT_KEYS = [
  ...new Set(
    LANGS.flatMap((lang) =>
      [...BUNDLES[lang]]
        .filter(([, value]) => value.includes('{{count}}'))
        .map(([key]) => key.replace(PLURAL_SUFFIX, '')),
    ),
  ),
].sort();

describe('i18n plural forms', () => {
  it('finds the count-interpolating keys at all (guards the guard)', () => {
    expect(COUNT_KEYS.length).toBeGreaterThan(0);
  });

  for (const lang of LANGS) {
    describe(lang, () => {
      for (const base of COUNT_KEYS) {
        it(`${base} has every form this language resolves`, () => {
          const bundle = BUNDLES[lang];
          const missing = SUFFIXES[lang].filter((s) => !bundle.has(`${base}_${s}`));
          expect(missing, `${lang}.json is missing ${base}_{${missing.join(',')}}`).toEqual([]);
        });

        it(`${base} has no suffix-less fallback shadowing the forms`, () => {
          // i18next resolves `key_one` … only when the un-suffixed key is
          // absent; leaving it behind reintroduces the single-form bug for
          // every count the forms were added to fix.
          expect(BUNDLES[lang].has(base)).toBe(false);
        });
      }
    });
  }
});

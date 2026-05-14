import { describe, it, expect } from 'vitest';

import uk from '@/locales/uk.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';

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

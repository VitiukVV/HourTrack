import { describe, expect, it } from 'vitest';

import en from '@/locales/en.json';
import es from '@/locales/es.json';
import uk from '@/locales/uk.json';

import { GUIDE_SECTIONS } from './guide';

// The guide is the app's own description of itself. A test cannot tell whether
// a sentence is TRUE — keeping it current is the release-process rule in
// `guide.ts` — but it holds the shape the sections are written to and catches
// copy for a section nobody renders any more.

const BUNDLES = { uk, en, es } as Record<string, Record<string, unknown>>;
const LANGS = ['uk', 'en', 'es'] as const;

/** Documented in `guide.ts`: 3–10 items per section, ≤220 characters each. */
const MIN_ITEMS = 3;
const MAX_ITEMS = 10;
const MAX_LENGTH = 220;

function guideOf(lng: string): Record<string, { title?: unknown; items?: unknown }> {
  const whatsNew = BUNDLES[lng]?.whatsNew as {
    guide?: Record<string, { title?: unknown; items?: unknown }>;
  };
  return whatsNew?.guide ?? {};
}

describe('feature guide', () => {
  it('every rendered section has a title and items in all three locales', () => {
    const missing: string[] = [];
    for (const section of GUIDE_SECTIONS) {
      for (const lng of LANGS) {
        const copy = guideOf(lng)[section.key];
        if (typeof copy?.title !== 'string' || !Array.isArray(copy.items)) {
          missing.push(`${lng}/${section.key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('carries no copy for a section the page does not render', () => {
    const rendered = new Set(GUIDE_SECTIONS.map((s) => s.key));
    const orphans = LANGS.flatMap((lng) =>
      Object.keys(guideOf(lng))
        .filter((key) => !rendered.has(key))
        .map((key) => `${lng}/${key}`),
    );
    expect(orphans).toEqual([]);
  });

  it('keeps every section within the size it is written to, with the same count per locale', () => {
    const wrong: string[] = [];
    for (const section of GUIDE_SECTIONS) {
      const counts = LANGS.map(
        (lng) => ((guideOf(lng)[section.key]?.items ?? []) as string[]).length,
      );
      if (new Set(counts).size !== 1) wrong.push(`${section.key}: ${counts.join('/')} items`);
      for (const lng of LANGS) {
        const items = (guideOf(lng)[section.key]?.items ?? []) as string[];
        if (items.length < MIN_ITEMS || items.length > MAX_ITEMS) {
          wrong.push(`${lng}/${section.key}: ${items.length} items`);
        }
        for (const item of items) {
          if (item.length > MAX_LENGTH) wrong.push(`${lng}/${section.key}: ${item.length} chars`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

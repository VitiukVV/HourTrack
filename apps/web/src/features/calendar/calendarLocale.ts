import { format } from 'date-fns';
import { enUS, es, uk } from 'date-fns/locale';
import type { Locale } from 'date-fns';

import type { SupportedLanguage } from '@/lib/i18n';

/**
 * Bridges i18next's active language to a date-fns `Locale` object so month
 * and weekday names render in the user's chosen language. The shape is small
 * on purpose: i18n keys in `calendar.*` carry the static labels (Today,
 * Next, Previous, ...), but month and weekday name TABLES are notoriously
 * error-prone to maintain by hand across uk/en/es — we let date-fns handle
 * them via the canonical CLDR data already bundled with the library.
 */
const LOCALES: Record<SupportedLanguage, Locale> = {
  uk,
  en: enUS,
  es,
};

function localeFor(lang: string | undefined): Locale {
  if (lang && lang in LOCALES) {
    return LOCALES[lang as SupportedLanguage];
  }
  return enUS;
}

/** "May 2026" / "Травень 2026" / "mayo 2026" depending on `lang`. */
export function formatMonthYear(date: Date | string, lang: string | undefined): string {
  const locale = localeFor(lang);
  const formatted = format(new Date(date), 'LLLL yyyy', { locale });
  // Title-case first letter so e.g. uk "травень 2026" → "Травень 2026".
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/** 3-letter weekday name in the active language, ordered Mon..Sun. */
export function weekdayShortNames(lang: string | undefined): string[] {
  const locale = localeFor(lang);
  // 2026-01-05 is a Monday → use that week as the reference week.
  const monday = new Date('2026-01-05T00:00:00');
  const names: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const short = format(day, 'EEE', { locale });
    names.push(short.charAt(0).toUpperCase() + short.slice(1));
  }
  return names;
}

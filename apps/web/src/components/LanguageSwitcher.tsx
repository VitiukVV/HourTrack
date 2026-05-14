import { useTranslation } from 'react-i18next';

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/lib/i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Runtime guard for the locale value extracted from i18next. Replaces the
 * raw `as SupportedLanguage` cast flagged as a S01 followup: i18next may
 * surface tags like `de-DE` (browser language detector) that pass the cast
 * silently and then break the `<SelectItem value=...>` match, leaving the
 * trigger blank.
 */
function normalizeLang(raw: string | undefined): SupportedLanguage {
  const base = (raw ?? 'en').split('-')[0] ?? 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base)
    ? (base as SupportedLanguage)
    : 'en';
}

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  // i18next may return `uk-UA` or even a non-supported tag like `de-DE` when
  // the browser-language-detector kicks in. Normalize to one of the three
  // SUPPORTED_LANGUAGES, falling back to `'en'` so the Select is never blank.
  const currentLang = normalizeLang(i18n.resolvedLanguage ?? i18n.language);

  const handleChange = (next: string) => {
    void i18n.changeLanguage(next);
  };

  return (
    <Select value={currentLang} onValueChange={handleChange}>
      <SelectTrigger
        aria-label={t('common.language')}
        className="h-8 w-[7.5rem]"
        data-testid="language-switcher"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <SelectItem key={lang} value={lang}>
            {t(`lang.${lang}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

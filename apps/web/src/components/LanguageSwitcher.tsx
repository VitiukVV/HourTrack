import { useTranslation } from 'react-i18next';

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/lib/i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  // i18next may return `uk-UA`; normalize to the base language for the Select value.
  const currentLang = (i18n.resolvedLanguage ?? i18n.language).split('-')[0] as SupportedLanguage;

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

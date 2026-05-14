import { useTranslation } from 'react-i18next';

import { AboutSection } from '@/features/settings/AboutSection';
import { ArchiveSection } from '@/features/settings/ArchiveSection';
import { CalendarSection } from '@/features/settings/CalendarSection';
import { BackupSection } from '@/features/backup/BackupSection';
import { InterfaceSection } from '@/features/settings/InterfaceSection';
import { ProfileSection } from '@/features/settings/ProfileSection';

/**
 * Settings page (S08) — assembles the six section cards in the order defined
 * by PROJECT_PLAN.md §8.4: Profile → Interface → Data → Card archive →
 * Google Calendar → About.
 *
 * Each section is self-contained and reads/writes through TanStack Query +
 * Dexie. The page itself is a layout-only component.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <section data-testid="settings-page" className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('nav.settings')}</h1>
      <ProfileSection />
      <InterfaceSection />
      <BackupSection />
      <ArchiveSection />
      <CalendarSection />
      <AboutSection />
    </section>
  );
}

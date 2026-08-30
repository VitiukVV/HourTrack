import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { CHANGELOG_RELEASES } from '@/features/whats-new/changelog';
import { useWhatsNewSeen } from '@/features/whats-new/useWhatsNewSeen';
import { formatDate } from '@/lib/date';
import { scrollPageToTop } from '@/lib/scroll';

/**
 * `/whats-new` route (S30). Lists `CHANGELOG_RELEASES` newest-first; each
 * release's copy comes from `whatsNew.releases.<i18nKey>.{title,items}`
 * (`items` is a translated string array via `returnObjects: true`).
 *
 * Marks the release list "seen" on mount so the Settings entry point's
 * "New" badge clears after this visit.
 */
export function WhatsNewPage() {
  const { t } = useTranslation();
  const { markSeen } = useWhatsNewSeen();

  useEffect(() => {
    markSeen();
    // react-router preserves the previous scroll offset across navigations,
    // so coming from a scrolled-down Settings this page would open mid-way.
    // NOTE: the live scroller is <body>, not the window — see scrollPageToTop.
    scrollPageToTop();
    // Runs once per mount -- `markSeen` is stable (useCallback, no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section data-testid="whats-new-page" className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="w-fit">
          <Link to="/settings">{t('whatsNew.back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{t('whatsNew.pageTitle')}</h1>
      </header>

      <div className="flex flex-col gap-4">
        {CHANGELOG_RELEASES.map((release) => {
          // `returnObjects` hands back the KEY STRING when the bundle for the
          // active language failed to load (boot deliberately tolerates that),
          // and `.map` on a string threw the whole page into the error
          // boundary. Fall back to an empty list instead.
          const raw = t(`whatsNew.releases.${release.i18nKey}.items`, {
            returnObjects: true,
          });
          const items: string[] = Array.isArray(raw) ? (raw as string[]) : [];

          return (
            <article
              key={release.version}
              data-testid="whats-new-release"
              className="border-border bg-card text-card-foreground rounded-lg border p-4 shadow-sm"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {t(`whatsNew.releases.${release.i18nKey}.title`)}
                </h2>
                <span className="text-muted-foreground text-sm">
                  {release.version} · {formatDate(release.date)}
                </span>
              </div>
              <ul className="text-muted-foreground flex flex-col gap-1.5 pl-4 text-sm">
                {items.map((item, idx) => (
                  <li key={idx} className="list-disc">
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

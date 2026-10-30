import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ShoppingItem } from '@/shared/types';
import { currentPeriod, shiftPeriod, shoppingItemsForMonth } from '@/shared/utils';

import { Button } from '@/components/ui/button';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { useCardsQuery } from '@/features/cards/useCards';
import { ShoppingHouseBlock } from '@/features/shopping/ShoppingHouseBlock';
import { useShoppingItems } from '@/features/shopping/useShoppingItems';
import { localeFor } from '@/lib/i18n/calendarLocale';

/**
 * /shopping — «Purchases» (spec 015): one block per active house, in the
 * user's card order, showing that house's list for the month being viewed.
 * Opens on the current month. Unbought items carry into later months by the
 * rule in `shoppingItemsForMonth`; archived houses are left out but keep
 * their items, which return with the house.
 */
export function ShoppingPage() {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState(currentPeriod);
  const cards = useCardsQuery();
  const items = useShoppingItems();

  const locale = localeFor(i18n.resolvedLanguage ?? i18n.language);
  const monthLabel = useMemo(() => {
    const formatted = format(parseISO(`${period}-01`), 'LLLL yyyy', { locale });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, [period, locale]);

  const months = useMemo(() => {
    const byCard = new Map<string, ShoppingItem[]>();
    for (const item of items.data ?? []) {
      const list = byCard.get(item.cardId) ?? [];
      list.push(item);
      byCard.set(item.cardId, list);
    }
    return new Map(
      [...byCard].map(([cardId, list]) => [cardId, shoppingItemsForMonth(list, period)]),
    );
  }, [items.data, period]);

  const isLoading = cards.isLoading || items.isLoading;
  const isError = cards.isError || items.isError;
  const houses = cards.data ?? [];

  return (
    <section className="flex flex-col gap-4" data-testid="shopping-page">
      <h1 className="text-2xl font-semibold tracking-tight">{t('shopping.title')}</h1>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
          aria-label={t('shopping.prevMonth')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <MonthPicker
          value={`${period}-01`}
          onChange={(anchor) => setPeriod(anchor.slice(0, 7))}
          aria-label={monthLabel}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
          aria-label={t('shopping.nextMonth')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-destructive text-sm" role="alert">
          {t('common.loadFailed')}
        </p>
      ) : houses.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="shopping-no-houses">
          {t('shopping.noHouses')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {houses.map((card) => (
            // Keyed by month too: each month re-decides open/collapsed.
            <li key={`${card.id}:${period}`}>
              <ShoppingHouseBlock
                card={card}
                month={months.get(card.id) ?? { needed: [], bought: [] }}
                period={period}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

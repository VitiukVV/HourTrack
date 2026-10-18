import { useTranslation } from 'react-i18next';

import { useOnboarding } from './onboardingContext';
import { TourStep } from './TourStep';

/**
 * Onboarding Step 2 — "Click a card to activate it".
 *
 * Anchors on `data-testid="cards-header-first-chip"` (set in CardsHeader on
 * the first rendered CardChip). When no cards exist yet, the chip selector
 * misses and the spotlight falls back to centered; we also surface a
 * "create one first" hint and disable Next so the user has to either
 * Skip or step Back and create a card.
 *
 * Once any card exists, Next advances to Step 3.
 */
export function Step2ActivateCard() {
  const { t } = useTranslation();
  const { hasCard } = useOnboarding();

  return (
    <TourStep
      titleKey="onboarding.step2Title"
      bodyKey="onboarding.step2Body"
      targetSelector={hasCard ? '[data-testid="cards-header-first-chip"]' : undefined}
      showBack
      nextDisabled={!hasCard}
      extra={
        hasCard ? null : (
          <p className="text-destructive text-xs italic">{t('onboarding.step2NeedCard')}</p>
        )
      }
    />
  );
}

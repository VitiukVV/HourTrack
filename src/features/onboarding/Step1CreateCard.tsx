import { TourStep } from './TourStep';

/**
 * Onboarding Step 1 — "Create your first card".
 *
 * Anchors on the `+` (add card) button in `CardsHeader`. The button carries
 * `data-testid="cards-header-add-button"` so this step can spotlight it
 * even when the page hasn't rendered cards yet.
 *
 * Step 1 has no Back button — the user can only Skip or proceed to Step 2.
 */
export function Step1CreateCard() {
  return (
    <TourStep
      titleKey="onboarding.step1Title"
      bodyKey="onboarding.step1Body"
      targetSelector='[data-testid="cards-header-add-button"]'
      showBack={false}
    />
  );
}

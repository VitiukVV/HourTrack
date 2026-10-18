import { TourStep } from './TourStep';

/**
 * Onboarding Step 3 — "Click days in the calendar to log work".
 *
 * Anchors on any `data-testid="day-cell-today"` element rendered by the
 * MonthView/WeekView for the current day. Today is guaranteed to be in
 * the grid when the user is on Home (the default route after sign-in).
 * If the user happens to be on a different route the selector misses and
 * the tooltip falls back to a centered card.
 *
 * Step 3's primary CTA is "Done" — `currentStep === 3` makes TourStep
 * pick `onboarding.done` automatically. Clicking it persists
 * `Settings.onboardingSeen = true`.
 */
export function Step3ClickDay() {
  return (
    <TourStep
      titleKey="onboarding.step3Title"
      bodyKey="onboarding.step3Body"
      targetSelector='[data-onboarding-anchor="today"]'
      showBack
    />
  );
}

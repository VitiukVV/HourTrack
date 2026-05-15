import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/features/auth/authContext';
import { useCardsQuery } from '@/features/cards/useCards';
import { useSettingsQuery, useUpdateSettingsMutation } from '@/features/settings/useSettings';

import {
  OnboardingContext,
  type OnboardingContextValue,
  type OnboardingStep,
} from './onboardingContext';

/**
 * Onboarding tour state machine + context.
 *
 * The tour activates exactly once: when the user finishes their first authed
 * sign-in (`Settings.firstLoginAt` becomes non-null) AND has never seen
 * the tour (`Settings.onboardingSeen === false`). It is dismissable from
 * any step — dismissal sets `onboardingSeen = true` and the tour never
 * resurfaces. Multi-device parity is handled by the Drive sync LWW for
 * `Settings.onboardingSeen` (OR-merge — once dismissed on any device, all
 * other devices learn about it on next pull).
 *
 * Step model:
 *   1. Create card    — anchors on the CardsHeader `+` button.
 *   2. Activate card  — anchors on the first card chip in CardsHeader. If
 *                       no cards exist yet, the body copy switches to a
 *                       "create one first" hint and the Next button is
 *                       disabled (no card to activate).
 *   3. Click day      — anchors on any DayCell. We pick `today` for the
 *                       spotlight target since that cell is always
 *                       rendered in the visible month.
 *
 * The provider owns the boolean `isActive` flag + the `currentStep`
 * pointer (1..3). It exposes `next()`, `back()`, `skip()`, `complete()`
 * to consumers. The actual visual layer (TourStep + Step1/2/3 components)
 * subscribes via `useOnboarding()` from `./onboardingContext`.
 *
 * Activation policy:
 *   - Status must be `authed` (no tour for anonymous users).
 *   - `firstLoginAt != null` AND `onboardingSeen === false` AND tour not
 *     already activated this session → activate, set step=1.
 *   - The provider does NOT auto-activate while settings load (`status:
 *     'loading'`); it waits for the next render after Dexie resolves.
 *   - Once dismissed (Skip / Done), `onboardingSeen` is written to Dexie
 *     via `useUpdateSettingsMutation`. The mutation also enqueues a
 *     `pushDataJson` op so Drive propagates the dismissal. We DON'T
 *     re-read Settings inside the same tab — `isActive` is flipped
 *     locally to avoid relying on the optimistic cache update timing.
 *
 * Test surface:
 *   - `data-testid="onboarding-tour"` on the active TourStep portal so
 *     E2E tests can assert presence/absence.
 *   - `data-testid="onboarding-skip"` on the Skip button (consistent
 *     across steps).
 *   - `data-testid="onboarding-next"` on the Next/Done button.
 */

interface OnboardingProviderProps {
  children: ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const auth = useAuth();
  const settingsQuery = useSettingsQuery();
  const cardsQuery = useCardsQuery();
  const updateSettings = useUpdateSettingsMutation();

  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);

  // Guard against re-activating the tour in the same tab after the user
  // dismisses it. Without this, the mutation's optimistic write to the
  // ['settings'] cache races the subsequent invalidate, briefly exposing
  // an `onboardingSeen=false` snapshot that would flip `isActive` back on.
  const dismissedInSessionRef = useRef(false);

  const onboardingSeen = settingsQuery.data?.onboardingSeen ?? false;
  const firstLoginAt = settingsQuery.data?.firstLoginAt ?? null;
  const isAuthed = auth.status === 'authed';

  // Activation effect — fires the tour the first time all conditions are
  // satisfied. Dependency on dismissed ref is intentionally omitted (refs
  // don't trigger renders); the check happens inline.
  useEffect(() => {
    if (!isAuthed) return;
    if (!settingsQuery.data) return; // Wait for first settings read.
    if (firstLoginAt === null) return; // AuthProvider hasn't stamped yet.
    if (onboardingSeen) return; // User already dismissed (this or another device).
    if (dismissedInSessionRef.current) return; // Just dismissed in this tab.
    if (isActive) return; // Already running.
    setIsActive(true);
    setCurrentStep(1);
  }, [isAuthed, settingsQuery.data, firstLoginAt, onboardingSeen, isActive]);

  const hasCard = (cardsQuery.data?.length ?? 0) > 0;

  const persistDismissal = useCallback(() => {
    dismissedInSessionRef.current = true;
    setIsActive(false);
    // Fire-and-forget — failure is non-blocking. Worst case the tour
    // re-fires on next session start because the write never persisted;
    // the in-session guard above prevents a same-tab loop.
    updateSettings.mutate(
      { onboardingSeen: true },
      {
        onError: (err) => {
          console.warn('[onboarding] persistDismissal failed', err);
        },
      },
    );
  }, [updateSettings]);

  const next = useCallback(() => {
    setCurrentStep((step) => {
      if (step === 3) {
        // Completion path — close + persist.
        persistDismissal();
        return step;
      }
      return (step + 1) as OnboardingStep;
    });
  }, [persistDismissal]);

  const back = useCallback(() => {
    setCurrentStep((step) => (step > 1 ? ((step - 1) as OnboardingStep) : step));
  }, []);

  const skip = useCallback(() => {
    persistDismissal();
  }, [persistDismissal]);

  const complete = useCallback(() => {
    persistDismissal();
  }, [persistDismissal]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      isActive,
      currentStep,
      hasCard,
      next,
      back,
      skip,
      complete,
    }),
    [isActive, currentStep, hasCard, next, back, skip, complete],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

// `useOnboarding` and the context types live in `./onboardingContext` so this
// module only exports React components (Fast Refresh constraint, mirrors the
// S09 AuthContext split). Consumers should import from
// `@/features/onboarding/onboardingContext`.

import { createContext, useContext } from 'react';

/**
 * Onboarding context surface — kept in its own file so the
 * `OnboardingProvider.tsx` module stays Fast-Refresh-friendly
 * (component-only export). Mirrors the S09 AuthContext split.
 */

export type OnboardingStep = 1 | 2 | 3;

export interface OnboardingContextValue {
  isActive: boolean;
  currentStep: OnboardingStep;
  /** True when at least one card exists — gates Step 2 advance. */
  hasCard: boolean;
  next: () => void;
  back: () => void;
  skip: () => void;
  /** Mark the tour finished. Idempotent. */
  complete: () => void;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/**
 * Inert default consumed when no provider is present. Keeps `useOnboarding`
 * non-throwing so test wrappers that don't care about onboarding (e.g.
 * App.test.tsx's smoke tree) can render `AppLayout` without an extra
 * provider mount. Production always has a real provider wrapping
 * RouterProvider (see `app/router.tsx`), so this fallback is purely a
 * test-safety net — it never fires in real renders.
 */
const NOOP_ONBOARDING: OnboardingContextValue = {
  isActive: false,
  currentStep: 1,
  hasCard: false,
  next: () => {
    /* noop */
  },
  back: () => {
    /* noop */
  },
  skip: () => {
    /* noop */
  },
  complete: () => {
    /* noop */
  },
};

export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext) ?? NOOP_ONBOARDING;
}

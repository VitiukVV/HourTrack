import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useOnboarding } from './onboardingContext';

/**
 * Single tour step renderer — a portal-based spotlight + tooltip card.
 *
 * Architecture (custom, ~3 KB, instead of react-joyride ~30 KB):
 *   - Renders into `document.body` via `createPortal` so the dim overlay
 *     can cover the entire viewport, including sticky headers.
 *   - The spotlight is a `<div>` positioned absolutely over the target's
 *     bounding rect, with a transparent background + a 9999px white
 *     box-shadow that "punches a hole" in the overlay. This is the
 *     cheapest cross-browser spotlight effect.
 *   - Target lookup goes through `data-testid` selectors (each Step
 *     component passes its own `targetSelector`). If the selector
 *     misses (target unmounted / not yet rendered), the step still
 *     renders as a centered modal-style card with NO spotlight. This
 *     keeps the tour usable even when an anchor element races mount.
 *   - Position is recomputed on resize/scroll via a single
 *     `ResizeObserver` + `scroll` listener — re-measuring is cheap
 *     compared to a full Joyride mount.
 *   - The tooltip card position prefers BELOW the target. If that
 *     would overflow the viewport, falls back to ABOVE; if both
 *     overflow (small viewports), pins to the center.
 *
 * a11y:
 *   - Tooltip card uses `role="dialog"`, `aria-modal="false"` (the
 *     overlay isn't truly modal — keyboard focus can still leak to
 *     the page; that's intentional so users can interact with the
 *     spotlighted control). `aria-labelledby` ties to the title id.
 *   - Skip button is visible from every step. Next button is the
 *     primary action. On Step 3 the primary action label is "Done".
 *   - The overlay is `pointer-events: none` so the spotlighted
 *     element remains clickable — this is the whole point of an
 *     onboarding tour, not a blocking modal.
 *
 * Closed-by-default: the parent (`OnboardingHost`) only mounts
 * TourStep when `isActive === true`. Don't gate inside TourStep — the
 * portal would still mount an invisible tree.
 */

export interface TourStepProps {
  /** Title key, looked up via i18n. */
  titleKey: string;
  /** Body key, looked up via i18n. */
  bodyKey: string;
  /**
   * Optional CSS selector for the element to spotlight (e.g.
   * `[data-testid="..."]` or `[data-onboarding-anchor="today"]`). Missing
   * or no-match → tooltip falls back to a centered card with no spotlight
   * hole.
   */
  targetSelector?: string;
  /** Show "Back" button (false on Step 1). */
  showBack?: boolean;
  /** Label override for the primary CTA. Defaults to `onboarding.next`. */
  nextKey?: string;
  /** Disable the primary CTA (e.g. Step 2 with no card yet). */
  nextDisabled?: boolean;
  /**
   * Optional content rendered between the body and the buttons. Used by
   * Step 2 to surface the "need a card first" hint.
   */
  extra?: ReactNode;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 8 as const;
const TOOLTIP_OFFSET = 12 as const;
const TOOLTIP_WIDTH = 320 as const;

/**
 * Resolve the target element by free-form CSS selector. Returns null when
 * the selector misses or no selector was provided. Safe to call during
 * SSR (no `document`) — returns null.
 *
 * Wrapped in try/catch so an invalid selector (e.g. unknown pseudo-class)
 * doesn't blow up the tour for the rest of the session.
 */
function findTarget(selector: string | undefined): HTMLElement | null {
  if (!selector) return null;
  if (typeof document === 'undefined') return null;
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

/**
 * Compute spotlight + tooltip positions relative to the target. If the
 * target is missing, returns `{ rect: null, tooltipStyle }` with the
 * tooltip pinned to center.
 */
function computePositions(target: HTMLElement | null): {
  rect: SpotlightRect | null;
  tooltipStyle: React.CSSProperties;
} {
  if (!target) {
    return {
      rect: null,
      tooltipStyle: {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: TOOLTIP_WIDTH,
      },
    };
  }
  const box = target.getBoundingClientRect();
  const rect: SpotlightRect = {
    top: box.top - SPOTLIGHT_PADDING,
    left: box.left - SPOTLIGHT_PADDING,
    width: box.width + SPOTLIGHT_PADDING * 2,
    height: box.height + SPOTLIGHT_PADDING * 2,
  };

  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const spaceBelow = viewportHeight - (box.bottom + TOOLTIP_OFFSET);
  const spaceAbove = box.top - TOOLTIP_OFFSET;

  // Tooltip placement: below if there is room, else above, else center.
  let tooltipTop: number;
  let placement: 'below' | 'above' | 'center';
  if (spaceBelow >= 200) {
    tooltipTop = box.bottom + TOOLTIP_OFFSET;
    placement = 'below';
  } else if (spaceAbove >= 200) {
    // Approximate tooltip height ~200 px so we anchor by its bottom.
    tooltipTop = box.top - TOOLTIP_OFFSET - 200;
    placement = 'above';
  } else {
    tooltipTop = Math.max(16, viewportHeight / 2 - 100);
    placement = 'center';
  }

  // Horizontal: try to center on the target, then clamp to viewport.
  const centeredLeft = box.left + box.width / 2 - TOOLTIP_WIDTH / 2;
  const clampedLeft = Math.max(16, Math.min(centeredLeft, viewportWidth - TOOLTIP_WIDTH - 16));

  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    top: placement === 'center' ? '50%' : tooltipTop,
    left: placement === 'center' ? '50%' : clampedLeft,
    transform: placement === 'center' ? 'translate(-50%, -50%)' : undefined,
    width: TOOLTIP_WIDTH,
  };
  return { rect, tooltipStyle };
}

export function TourStep({
  titleKey,
  bodyKey,
  targetSelector,
  showBack = false,
  nextKey,
  nextDisabled = false,
  extra,
}: TourStepProps) {
  const { t } = useTranslation();
  const { currentStep, next, back, skip } = useOnboarding();

  const [positions, setPositions] = useState<ReturnType<typeof computePositions>>(() => ({
    rect: null,
    tooltipStyle: {},
  }));

  // useLayoutEffect so the first paint already has the correct position —
  // avoids a frame where the tooltip jumps from center to anchored.
  useLayoutEffect(() => {
    const target = findTarget(targetSelector);
    setPositions(computePositions(target));
  }, [targetSelector, currentStep]);

  // Reposition on window resize / scroll. Use passive listeners + RAF so we
  // don't fight the layout thread.
  useEffect(() => {
    let rafId = 0;
    const recompute = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const target = findTarget(targetSelector);
        setPositions(computePositions(target));
      });
    };
    window.addEventListener('resize', recompute, { passive: true });
    window.addEventListener('scroll', recompute, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute);
    };
  }, [targetSelector]);

  // Allow Escape to skip the tour for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [skip]);

  if (typeof document === 'undefined') return null;

  const titleId = `onboarding-step-title-${currentStep}`;

  return createPortal(
    // The outer wrapper is what tests query via `data-testid="onboarding-tour"`.
    // Giving it `position: fixed; inset: 0` ensures Playwright's
    // `toBeVisible()` sees a non-zero bounding box; without it, the wrapper
    // has zero intrinsic size (its children are all `position: fixed` and
    // float free of the parent), and Playwright would treat it as hidden.
    // `pointer-events: none` makes sure the wrapper itself never swallows
    // clicks meant for the spotlighted element — pointer events are
    // re-enabled on the tooltip card via `pointer-events-auto` below.
    <div
      data-testid="onboarding-tour"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-[99]"
    >
      {/* Dim overlay — pointer-events: none so the spotlighted element
          stays clickable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[100]"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0)' }}
      />
      {/* Spotlight box — a hole punched out of the overlay via a huge
          box-shadow. When there is no target we just don't render this. */}
      {positions.rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[101] rounded-md"
          style={{
            top: positions.rect.top,
            left: positions.rect.left,
            width: positions.rect.width,
            height: positions.rect.height,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
            transition: 'top 120ms, left 120ms, width 120ms, height 120ms',
          }}
        />
      )}
      {/* Tooltip card. */}
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className={cn(
          'border-border bg-popover text-popover-foreground pointer-events-auto z-[102] rounded-lg border p-4 shadow-xl',
        )}
        style={positions.tooltipStyle}
      >
        <header className="mb-2 flex items-baseline justify-between gap-3">
          <h2 id={titleId} className="text-sm font-semibold tracking-tight">
            {t(titleKey)}
          </h2>
          <span className="text-muted-foreground text-xs">
            {t('onboarding.stepProgress', { current: currentStep, total: 3 })}
          </span>
        </header>
        <p className="text-muted-foreground mb-3 text-sm leading-relaxed">{t(bodyKey)}</p>
        {extra}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="onboarding-skip"
            onClick={skip}
          >
            {t('onboarding.skip')}
          </Button>
          <div className="flex items-center gap-2">
            {showBack && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="onboarding-back"
                onClick={back}
              >
                {t('onboarding.back')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={nextDisabled}
              data-testid="onboarding-next"
              onClick={next}
            >
              {t(nextKey ?? (currentStep === 3 ? 'onboarding.done' : 'onboarding.next'))}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared empty-state placeholder. Centered, dashed-border, with a title,
 * body, and optional CTA slot.
 *
 * S13 task #7 — used across cards (header empty), entries (day page empty),
 * reports (no data), and archive (no archived cards).
 *
 * Design notes:
 *   - Pure presentational; no i18n calls. Callers translate copy at the
 *     callsite so the empty state stays generic.
 *   - The `cta` slot accepts any ReactNode (typically a `<Button>`) so we
 *     don't lock the component to a specific button surface.
 *   - `data-testid="empty-state"` is forwarded for E2E tests.
 */

export interface EmptyStateProps {
  /** Title text (translated by caller). */
  title: string;
  /** Body text (translated by caller). */
  body: string;
  /** Optional CTA — typically a `<Button>` element. */
  cta?: ReactNode;
  /** Override the test-id when multiple empty states sit in one route. */
  testId?: string;
  className?: string;
}

export function EmptyState({
  title,
  body,
  cta,
  testId = 'empty-state',
  className,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'border-border bg-card flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center',
        className,
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground max-w-md text-sm">{body}</p>
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  );
}

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils/utils';

interface DisclosureProps {
  /** The always-visible part: it is the toggle's own label, so keep it short. */
  header: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Applied to the card. */
  className?: string;
}

/**
 * A card that opens on tap (ported from my-diary).
 *
 * The panel stays mounted and is clipped by a `grid-template-rows: 0fr → 1fr`
 * wrapper — the one way to animate to a height nobody knows in advance.
 * `aria-hidden` + `inert` on the collapsed panel keep its text out of the
 * screen reader and its controls out of the tab order until the card opens.
 */
export function Disclosure({ header, children, defaultOpen = false, className }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <article
      className={cn('border-border bg-card text-card-foreground overflow-hidden rounded-lg border shadow-sm', className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 p-4 text-left transition-colors duration-150 ease-out outline-none"
      >
        <span className="min-w-0 flex-1">{header}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform duration-200 ease-out',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div id={panelId} aria-hidden={!open} inert={!open} className="overflow-hidden">
          <div className="px-4 pb-4">{children}</div>
        </div>
      </div>
    </article>
  );
}

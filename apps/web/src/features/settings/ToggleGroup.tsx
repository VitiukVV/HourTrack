import { useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * Lightweight, controlled toggle-group (radio-style) used by the Settings
 * Interface section for Theme and Default-view selectors. Renders a row of
 * `<button>` elements with `aria-pressed` reflecting the selection.
 *
 * Why not Radix `<ToggleGroup>`? S08's budget didn't justify pulling in
 * `@radix-ui/react-toggle-group` for two selectors. The button row + `aria-
 * pressed` pattern is accessible and matches the existing
 * `ReportsFilters` period-button pattern (S07) byte-for-byte, keeping the
 * surface consistent.
 *
 * Generic over the option value so the caller's union type (e.g. `Theme`)
 * survives. Each button gets `data-value={option.value}` so component tests
 * can target a specific button without depending on the visible label.
 */
export interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

export interface ToggleGroupProps<T extends string> {
  value: T;
  options: ToggleOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  /** Optional testid forwarded to the wrapping div. */
  testId?: string;
}

export function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  testId,
}: ToggleGroupProps<T>) {
  const groupId = useId();
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className="border-border inline-flex rounded-md border p-0.5"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            id={`${groupId}-${opt.value}`}
            data-value={opt.value}
            aria-pressed={isActive}
            onClick={() => onChange(opt.value)}
            className={cn(
              // 44px min touch target on phones (matches the S18 Button/Input
              // treatment), collapsing to the dense desktop height at `sm:+`.
              // focus-visible ring brings keyboard focus styling in line with
              // every other interactive control in the app.
              'focus-visible:ring-ring inline-flex min-h-[44px] items-center justify-center rounded px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 sm:min-h-0',
              isActive
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

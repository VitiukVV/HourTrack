import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * S16 -- shared HH:MM time-of-day input primitive.
 *
 * The component wraps the native `<input type="time">` element (which gives
 * us free keyboard / spinner / accessibility behavior on every modern
 * browser, plus a system-native picker on mobile) and exposes a numeric
 * minutes-since-midnight API to its caller.
 *
 * Why minutes-since-midnight (not a `Date` or `string`)?
 *   - The data model (`Card.defaultStartMinutes`, `Entry.startMinutes`)
 *     stores minutes since local midnight as an integer. Doing the
 *     conversion inside this component keeps every consumer free of
 *     time-of-day parsing.
 *   - It avoids the timezone trap: a `Date` carries a UTC offset, and a
 *     string ("10:00") is ambiguous without parse rules. An integer in
 *     `[0, 1439]` has exactly one interpretation.
 *
 * NB: this component is **shipped unused this sprint**. S16b mounts it in
 * CardForm + EntryEditor + day-click prefill. Splitting the primitive
 * lets reviewers audit its keyboard / a11y behavior in isolation from
 * the form integration.
 */

/**
 * Convert minutes-since-midnight to a zero-padded `HH:MM` string suitable
 * for the native `<input type="time">` `value` attribute.
 *
 * Values outside `[0, 1439]` are clamped to the nearest in-range value so
 * a stale upstream prop never crashes the input. The caller is responsible
 * for validating with Zod before persisting.
 */
export function minutesToHHMM(minutes: number): string {
  if (!Number.isFinite(minutes)) return '00:00';
  const clamped = Math.max(0, Math.min(1439, Math.trunc(minutes)));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Parse a `HH:MM` string from `<input type="time">` back into minutes
 * since midnight. Returns `null` for empty / unparseable input so the
 * caller can decide whether to fall back to the previous value, surface
 * a validation error, or no-op.
 */
export function parseHHMM(value: string): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export interface TimeInputProps {
  /** Minutes since local midnight. Range `[0, 1439]`. */
  value: number;
  /** Fired whenever the user picks a valid HH:MM. Receives an integer in `[0, 1439]`. */
  onChange: (minutesSinceMidnight: number) => void;
  /** DOM id forwarded to the native input. */
  id?: string;
  /** Accessible label forwarded to the native input. */
  'aria-label'?: string;
  /** Standard disabled flag. */
  disabled?: boolean;
  /** Extra Tailwind classes, merged after the default styling. */
  className?: string;
}

/**
 * The native input only fires `onChange` with valid HH:MM strings (any
 * unparseable state surfaces as an empty `value` until the user commits a
 * full pick), so the wrapper only invokes `onChange` when `parseHHMM`
 * succeeds. An empty/cleared input is a no-op — the caller's stored value
 * is preserved.
 */
const TimeInput = React.forwardRef<HTMLInputElement, TimeInputProps>(
  ({ value, onChange, id, disabled, className, ...rest }, ref) => {
    const ariaLabel = rest['aria-label'];
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = parseHHMM(event.target.value);
      if (next !== null) onChange(next);
    };
    return (
      <input
        ref={ref}
        id={id}
        type="time"
        // Theme-match the existing `Input` primitive so consumers get the
        // same border + focus ring + dark-mode treatment without having
        // to wrap us in another <Input>.
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        value={minutesToHHMM(value)}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
    );
  },
);
TimeInput.displayName = 'TimeInput';

export { TimeInput };

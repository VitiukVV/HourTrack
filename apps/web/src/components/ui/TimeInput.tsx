import * as React from 'react';

import { cn } from '@/lib/utils/utils';
import { noAutofill } from '@/lib/utils/noAutofill';
import { minutesToHHMM, parseHHMM } from '@/lib/utils/timeOfDay';

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
    // Native `<input type="time">` styled to match the shadcn Input
    // primitive — keeps the browser's own picker indicator (one
    // affordance, no double icons). Width is `w-auto` so the field hugs
    // its content (HH:MM + the picker indicator) — important on mobile
    // where a fixed wide field looks oversized for the actual value.
    // Consumers can still override via `className`.
    return (
      <input
        // A time field next to a date field is exactly the pair Chrome reads
        // as payment data — the primitive opts out for every caller.
        {...noAutofill(id ?? 'time')}
        ref={ref}
        id={id}
        type="time"
        className={cn(
          'border-input bg-background focus-visible:ring-ring inline-flex h-10 w-auto items-center rounded-md border px-3 text-base font-medium tabular-nums shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 hover:[&::-webkit-calendar-picker-indicator]:opacity-100',
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

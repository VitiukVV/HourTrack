import { z } from 'zod';

/**
 * Validation schema for the EntryEditor form (S06).
 *
 * Form-input shape (what the user types):
 *   - hours: integer 0..23
 *   - minutes: integer 0..59
 *   - startMinutes: integer 0..1439 (S16; minutes since local midnight)
 *   - useCustomPayment: boolean
 *   - customPayment: number | null  (positive number when useCustomPayment is ON)
 *   - note: string | null            (collapses '' → null)
 *
 * Parsed output shape (what the DB layer expects):
 *   - durationMin: hours*60 + minutes
 *   - startMinutes: integer 0..1439
 *   - useCustomPayment: boolean
 *   - customPayment: number | null  (always null when useCustomPayment is false)
 *   - note: string | null
 *
 * Rules mirror S03's `cardSchema.ts` discipline: error messages are stable
 * i18n keys (see `entries.validation.*`) so the form surface can translate
 * them at render time.
 *
 * Invariants:
 *   - durationMin >= 1 (a zero-length entry has no meaning — it carries no
 *     hours and no rate-derived earnings; UR #21 says single entries can go
 *     up to 23h 59m which is already enforced by hours<=23 + minutes<=59).
 *   - When useCustomPayment is true, customPayment must be a non-negative
 *     number (zero is allowed — a "logged 0 EUR" entry can be legitimate
 *     e.g. unpaid extra work).
 *   - When useCustomPayment is false, customPayment is always null in the
 *     parsed output regardless of what the input held (handles the case where
 *     the user toggled custom OFF without clearing the stale amount).
 *   - S16: `startMinutes + (hours*60 + minutes) <= 1440`. No past-midnight
 *     wrap in v2 (the limitation is documented on `Entry.startMinutes`).
 */

const inputShape = z.object({
  hours: z
    .number({ invalid_type_error: 'entries.validation.hoursRange' })
    .int('entries.validation.hoursRange')
    .min(0, 'entries.validation.hoursRange')
    .max(23, 'entries.validation.hoursRange'),
  minutes: z
    .number({ invalid_type_error: 'entries.validation.minutesRange' })
    .int('entries.validation.minutesRange')
    .min(0, 'entries.validation.minutesRange')
    .max(59, 'entries.validation.minutesRange'),
  // S16: minutes since local midnight. 0 (00:00) is valid; 1439 (23:59) is
  // the max start. The cross-field check below enforces that the entry
  // window (start + duration) does not wrap past midnight.
  startMinutes: z
    .number({ invalid_type_error: 'entries.validation.startMinutesRange' })
    .int('entries.validation.startMinutesRange')
    .min(0, 'entries.validation.startMinutesRange')
    .max(1439, 'entries.validation.startMinutesRange'),
  useCustomPayment: z.boolean(),
  customPayment: z.union([z.number(), z.null()]),
  note: z.union([z.string().max(500, 'entries.validation.noteTooLong'), z.null()]),
});

export const EntryEditorSchema = inputShape
  .superRefine((data, ctx) => {
    const durationMin = data.hours * 60 + data.minutes;
    if (durationMin < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hours'],
        message: 'entries.validation.durationPositive',
      });
    }
    // S16: enforce `startMinutes + durationMin <= 1440`. No past-midnight
    // wrap in v2; the user has to log a second entry for the next day.
    // Attaching the issue to `startMinutes` (not `minutes`) so the form's
    // time-input visually highlights — and so the test suite can reliably
    // match the path.
    if (data.startMinutes + durationMin > 1440) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startMinutes'],
        message: 'entries.validation.timeOverflow',
      });
    }
    if (data.useCustomPayment) {
      if (data.customPayment == null || data.customPayment < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customPayment'],
          message: 'entries.validation.customPaymentNonNegative',
        });
      }
    }
  })
  .transform((data) => ({
    durationMin: data.hours * 60 + data.minutes,
    startMinutes: data.startMinutes,
    useCustomPayment: data.useCustomPayment,
    // When toggle is OFF, parsed customPayment is always null regardless of
    // any stale value sitting in the form state.
    customPayment: data.useCustomPayment ? (data.customPayment ?? null) : null,
    note: data.note === '' ? null : data.note,
  }));

export type EntryEditorInput = z.input<typeof EntryEditorSchema>;
export type EntryEditorParsed = z.output<typeof EntryEditorSchema>;

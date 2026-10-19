import { z } from 'zod';

import { MONTH_ADJUSTMENT_MAX } from '@/shared/utils';

/**
 * Validation schema for the Mark-paid / edit-payment form (S27).
 *
 * Form-input shape only — `id`, `cardId`, `period`, and timestamps are stamped
 * by the caller / query layer. Error messages use stable i18n keys
 * (`payments.validation.*`) translated at render via `lib/i18n/zodI18n.ts`.
 *
 *   - amount: a positive number (partial payments are smaller positive rows,
 *     never zero or negative).
 *   - paidOn: a `YYYY-MM-DD` local date (native `<input type="date">`).
 *   - note: optional free text, capped at 500 chars.
 */
export const PaymentFormSchema = z.object({
  amount: z
    .number({ error: 'payments.validation.amountRequired' })
    .positive('payments.validation.amountPositive'),
  paidOn: z
    .string({ error: 'payments.validation.dateRequired' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'payments.validation.dateInvalid'),
  note: z
    .union([z.string().max(500, 'payments.validation.noteTooLong'), z.null()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v)),
});

export type PaymentFormInput = z.input<typeof PaymentFormSchema>;
export type PaymentFormParsed = z.output<typeof PaymentFormSchema>;

/**
 * Spec 011 — the month's expected amount (Payments page). Unlike a payment it
 * may be 0 (nothing is due this month). At most cent precision; capped so a
 * typo can't wreck the month's totals (`MONTH_ADJUSTMENT_MAX`, which the repo
 * enforces again on write).
 */
export const ExpectedAmountSchema = z.object({
  amount: z
    .number({ error: 'payments.validation.amountRequired' })
    .min(0, 'payments.validation.expectedNonNegative')
    .max(MONTH_ADJUSTMENT_MAX, 'payments.validation.expectedTooLarge')
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
      'payments.validation.expectedCents',
    ),
});

export type ExpectedAmountParsed = z.output<typeof ExpectedAmountSchema>;

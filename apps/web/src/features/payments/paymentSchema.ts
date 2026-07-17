import { z } from 'zod';

/**
 * Validation schema for the Mark-paid / edit-payment form (S27).
 *
 * Form-input shape only — `id`, `cardId`, `period`, and timestamps are stamped
 * by the caller / query layer. Error messages use stable i18n keys
 * (`payments.validation.*`) translated at render via `lib/zodI18n.ts`.
 *
 *   - amount: a positive number (partial payments are smaller positive rows,
 *     never zero or negative).
 *   - paidOn: a `YYYY-MM-DD` local date (native `<input type="date">`).
 *   - note: optional free text, capped at 500 chars.
 */
export const PaymentFormSchema = z.object({
  amount: z
    .number({
      required_error: 'payments.validation.amountRequired',
      invalid_type_error: 'payments.validation.amountRequired',
    })
    .positive('payments.validation.amountPositive'),
  paidOn: z
    .string({ required_error: 'payments.validation.dateRequired' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'payments.validation.dateInvalid'),
  note: z
    .union([z.string().max(500, 'payments.validation.noteTooLong'), z.null()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v)),
});

export type PaymentFormInput = z.input<typeof PaymentFormSchema>;
export type PaymentFormParsed = z.output<typeof PaymentFormSchema>;

import { z } from 'zod';

import { CARD_COLORS } from '@/lib/colors';

/**
 * Validation schema for the Card create/edit form.
 *
 * This is the form-input shape (no id / timestamps / archive flags — those are
 * stamped by the query layer or supplied by the caller around the mutation).
 * The zod schema mirrors the data invariants enforced by `assertCardShape` in
 * `@/lib/db/queries.ts` (per S03 followup #2 from the S02 journal) so the UI
 * fails fast with friendly messages BEFORE the DB-level defensive check
 * throws.
 *
 * Rules:
 * - name: 1..60 chars
 * - color: must be one of the 12 hex values in CARD_COLORS
 * - defaultDurationMin: 1..1440 (a single day's worth of minutes)
 * - rateType + invariants:
 *   - `hourly` => hourlyRate > 0 (non-null), fixedTotal === null
 *   - `fixed`  => fixedTotal > 0 (non-null), hourlyRate === null
 * - defaultNote: optional (null or 0..500 chars)
 *
 * Error messages use stable i18n keys (see `cards.validation.*`). The form
 * surface translates them at render time.
 */

const colorLiteral = z.enum(CARD_COLORS as readonly [string, ...string[]], {
  errorMap: () => ({ message: 'cards.validation.colorInvalid' }),
});

const baseShape = {
  name: z
    .string({ required_error: 'cards.validation.nameRequired' })
    .trim()
    .min(1, 'cards.validation.nameRequired')
    .max(60, 'cards.validation.nameTooLong'),
  color: colorLiteral,
  defaultDurationMin: z
    .number({ invalid_type_error: 'cards.validation.durationPositive' })
    .int('cards.validation.durationPositive')
    .min(1, 'cards.validation.durationPositive')
    .max(1440, 'cards.validation.durationPositive'),
  defaultNote: z
    .union([z.string().max(500, 'cards.validation.noteTooLong'), z.null()])
    .optional()
    .transform((v) => (v === undefined ? null : v)),
};

export const CardInputSchema = z
  .discriminatedUnion('rateType', [
    z.object({
      ...baseShape,
      rateType: z.literal('hourly'),
      hourlyRate: z
        .number({
          required_error: 'cards.validation.hourlyRateRequired',
          invalid_type_error: 'cards.validation.hourlyRateRequired',
        })
        .positive('cards.validation.hourlyRatePositive'),
      fixedTotal: z
        .null({ invalid_type_error: 'cards.validation.fixedTotalRequired' })
        .refine((v) => v === null, {
          message: 'cards.validation.fixedTotalRequired',
        }),
    }),
    z.object({
      ...baseShape,
      rateType: z.literal('fixed'),
      hourlyRate: z
        .null({ invalid_type_error: 'cards.validation.hourlyRateRequired' })
        .refine((v) => v === null, {
          message: 'cards.validation.hourlyRateRequired',
        }),
      fixedTotal: z
        .number({
          required_error: 'cards.validation.fixedTotalRequired',
          invalid_type_error: 'cards.validation.fixedTotalRequired',
        })
        .positive('cards.validation.fixedTotalPositive'),
    }),
  ])
  // Normalise null/empty-string note to null so the DB layer never sees ''.
  .transform((data) => ({
    ...data,
    defaultNote: data.defaultNote === '' ? null : (data.defaultNote ?? null),
  }));

export type CardInput = z.input<typeof CardInputSchema>;
export type CardInputParsed = z.output<typeof CardInputSchema>;

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
 * - color: must be one of the 12 hex values in CARD_COLORS, OR (S19 Task 8)
 *   the same hex as the card's pre-existing color when supplied via
 *   `buildCardInputSchema(prevColor)` — allows edit of legacy-palette cards
 *   without forcing re-pick.
 * - defaultDurationMin: 1..1440 (a single day's worth of minutes)
 * - defaultStartMinutes: 0..1439 (minutes since local midnight; S16)
 * - rateType + invariants:
 *   - `hourly`  => hourlyRate > 0 (non-null), fixedTotal === null, monthlyTotal === null
 *   - `fixed`   => fixedTotal > 0 (non-null), hourlyRate === null, monthlyTotal === null
 *   - `monthly` => monthlyTotal > 0 (non-null), hourlyRate === null, fixedTotal === null
 *                  (S21: flat retainer model, see Card.monthlyTotal docs)
 * - defaultNote: optional (null or 0..500 chars)
 *
 * Error messages use stable i18n keys (see `cards.validation.*`). The form
 * surface translates them at render time.
 */

const palette = new Set<string>(CARD_COLORS);

/**
 * Build the schema. The default export (`CardInputSchema`) is the strict
 * "new-palette-only" variant; passing a `previousColor` returns a variant
 * that ALSO accepts that one extra hex (used by the edit form when the
 * card was created against the pre-S19 palette).
 *
 * S19 Task 8: legacy-color migration is deferred — happens organically when
 * users edit a legacy-vintage card and pick a new-palette color on save.
 * Until then we don't break the edit flow.
 */
export function buildCardInputSchema(previousColor?: string) {
  const allowed = previousColor && !palette.has(previousColor) ? previousColor : null;

  const colorLiteral = z
    .string({
      required_error: 'cards.validation.colorInvalid',
      invalid_type_error: 'cards.validation.colorInvalid',
    })
    .refine((v) => palette.has(v) || (allowed != null && v === allowed), {
      message: 'cards.validation.colorInvalid',
    });

  const baseShape = {
    name: z
      .string({ required_error: 'cards.validation.nameRequired' })
      .trim()
      .min(1, 'cards.validation.nameRequired')
      .max(60, 'cards.validation.nameTooLong'),
    color: colorLiteral,
    // S19 (Task 3): allow `0` as the seeded default in create mode. The
    // form starts with `hours=0, minutes=0` so the user has to type the
    // actual duration; we don't reject the initial state outright. Upper
    // bound stays at 1440 (a single day). The DB-side defensive
    // `assertCardShape` keeps the same range.
    defaultDurationMin: z
      .number({ invalid_type_error: 'cards.validation.durationPositive' })
      .int('cards.validation.durationPositive')
      .min(0, 'cards.validation.durationPositive')
      .max(1440, 'cards.validation.durationPositive'),
    // S16: minutes since local midnight, 00:00 (0) inclusive through 23:59
    // (1439) inclusive. Required field; no default in the schema because the
    // form mounts a TimeInput with an explicit initial value (S16b).
    defaultStartMinutes: z
      .number({ invalid_type_error: 'cards.validation.defaultStartMinutesRange' })
      .int('cards.validation.defaultStartMinutesRange')
      .min(0, 'cards.validation.defaultStartMinutesRange')
      .max(1439, 'cards.validation.defaultStartMinutesRange'),
    defaultNote: z
      .union([z.string().max(500, 'cards.validation.noteTooLong'), z.null()])
      .optional()
      .transform((v) => (v === undefined ? null : v)),
  };

  return z
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
        // S21: monthly retainer field must be null when the card is not monthly.
        monthlyTotal: z
          .null({ invalid_type_error: 'cards.validation.monthlyTotalNotNull' })
          .refine((v) => v === null, {
            message: 'cards.validation.monthlyTotalNotNull',
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
        monthlyTotal: z
          .null({ invalid_type_error: 'cards.validation.monthlyTotalNotNull' })
          .refine((v) => v === null, {
            message: 'cards.validation.monthlyTotalNotNull',
          }),
      }),
      // S21: monthly retainer card. `monthlyTotal` must be a positive number;
      // both hourlyRate and fixedTotal are kept null by the resolver.
      z.object({
        ...baseShape,
        rateType: z.literal('monthly'),
        hourlyRate: z
          .null({ invalid_type_error: 'cards.validation.hourlyRateRequired' })
          .refine((v) => v === null, {
            message: 'cards.validation.hourlyRateRequired',
          }),
        fixedTotal: z
          .null({ invalid_type_error: 'cards.validation.fixedTotalRequired' })
          .refine((v) => v === null, {
            message: 'cards.validation.fixedTotalRequired',
          }),
        monthlyTotal: z
          .number({
            required_error: 'cards.validation.monthlyTotalRequired',
            invalid_type_error: 'cards.validation.monthlyTotalRequired',
          })
          .positive('cards.validation.monthlyTotalRequired'),
      }),
    ])
    .transform((data) => ({
      ...data,
      defaultNote: data.defaultNote === '' ? null : (data.defaultNote ?? null),
    }));
}

export const CardInputSchema = buildCardInputSchema();

export type CardInput = z.input<typeof CardInputSchema>;
export type CardInputParsed = z.output<typeof CardInputSchema>;

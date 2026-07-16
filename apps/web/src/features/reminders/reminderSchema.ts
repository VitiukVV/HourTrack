import { z } from 'zod';

/**
 * Validation schema for the create/edit-reminder form (S28).
 *
 * Form-input shape only — `id`, timestamps, sync fields are stamped by the
 * query layer. Error messages use stable i18n keys (`reminders.validation.*`)
 * translated at render via `lib/zodI18n.ts`.
 *
 *   - text: required free text, capped at 200 chars.
 *   - dueDate: a `YYYY-MM-DD` local date (native `<input type="date">`).
 *   - dueMinutes: minutes-since-midnight `[0, 1439]` (from `TimeInput`).
 */
export const ReminderFormSchema = z.object({
  text: z
    .string({ required_error: 'reminders.validation.textRequired' })
    .trim()
    .min(1, 'reminders.validation.textRequired')
    .max(200, 'reminders.validation.textRequired'),
  dueDate: z
    .string({ required_error: 'reminders.validation.dateRequired' })
    .min(1, 'reminders.validation.dateRequired')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'reminders.validation.dateInvalid'),
  dueMinutes: z.number().int().min(0).max(1439),
});

export type ReminderFormInput = z.input<typeof ReminderFormSchema>;
export type ReminderFormParsed = z.output<typeof ReminderFormSchema>;

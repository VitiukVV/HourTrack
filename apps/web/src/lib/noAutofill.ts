/**
 * Attributes that keep browser autofill (and password managers) away from a
 * field.
 *
 * The lesson is my-diary's, learned on a phone: an unnamed decimal field
 * sitting next to a date field reads as "card number + expiry" to Chrome's
 * payment heuristics, which then offers a saved CARD above the keyboard — and
 * `autocomplete="off"` alone does NOT turn payment autofill off. Giving every
 * field an explicit, boring `name` is what actually defeats the guess; the
 * vendor attributes cover the managers that ignore `autocomplete`.
 *
 * HourTrack has exactly that shape in several places (an amount next to a date
 * in `MarkPaidDialog`, `EntryEditor`, `CardForm`), and used to carry only a
 * hand-written `autoComplete="off"` on some of them.
 *
 * Usage: `<Input type="text" {...noAutofill('amount')} … />`
 *
 * The companion `noAutofill.test.ts` walks the sources so a field added later
 * cannot skip this.
 */
export function noAutofill(name: string) {
  return {
    name,
    autoComplete: 'off',
    'data-form-type': 'other', // Dashlane
    'data-lpignore': 'true', // LastPass
    'data-1p-ignore': '', // 1Password
  } as const;
}

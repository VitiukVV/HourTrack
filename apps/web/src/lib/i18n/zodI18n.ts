import { useTranslation } from 'react-i18next';

/**
 * Hook for translating zod validation messages that travel as i18n keys.
 *
 * Convention used across forms: zod schemas emit `<prefix>.validation.<name>`
 * (e.g. `cards.validation.nameRequired`). The returned function takes a raw
 * message from `errors.<field>.message` and, if it starts with `<prefix>.`,
 * passes it through `t()`. Anything else (a literal message, a stray dev
 * typo) is returned as-is so it surfaces verbatim instead of disappearing.
 *
 * Replaces the duplicated `tMsg` helpers that used to live inside
 * `CardForm.tsx` and `EntryEditor.tsx`.
 */
export function useZodMessageTranslator(
  prefix: string,
): (msg: string | undefined) => string | undefined {
  const { t } = useTranslation();
  return (msg) => {
    if (!msg) return undefined;
    if (msg.startsWith(prefix + '.')) return t(msg);
    return msg;
  };
}

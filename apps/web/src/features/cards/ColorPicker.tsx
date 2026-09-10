import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CARD_COLORS,
  LABEL_CONTRAST_THRESHOLD,
  getLabelContrast,
  isValidCardColor,
  isValidHexColor,
  type CardColor,
} from '@/lib/colors';
import { noAutofill } from '@/lib/noAutofill';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: string;
  onChange: (color: CardColor | string) => void;
  /** Optional id to wire up `aria-labelledby` from the surrounding form field. */
  id?: string;
}

/** Shared swatch geometry — 44px minimum target on phones, 36px visual on `sm:+`. */
const SWATCH_CLASS =
  'focus-visible:ring-ring h-9 min-h-[44px] w-9 min-w-[44px] rounded-full border-2 transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-0 sm:min-w-0';

/**
 * Card colour picker: the twelve presets, plus the user's own colour.
 *
 * 001-cards-order-colors opened the palette. The presets stay — they are the
 * fast path and they carry the curated Google Calendar mapping — but the
 * twelve had run out of distinguishable colours, so two custom controls sit
 * beside them: a native `<input type="color">` (the OS picker, which is what
 * a phone user actually wants) and a hex field for typing an exact value.
 *
 * Two details are deliberate:
 *
 *   - **The current colour is always the first swatch** when it is not one of
 *     the presets, and the hex field is always pre-filled with it (FR-009b),
 *     so reopening a card with a custom colour shows what it actually is
 *     rather than an empty control. This generalises the S19 "legacy swatch",
 *     which existed for pre-S19 palette cards — now every off-preset colour
 *     takes that slot, legacy or freshly chosen.
 *   - **The contrast note is advisory** (FR-009c). It appears only when
 *     neither label colour reaches 4.5:1 on the chosen background, and it
 *     never blocks saving: it is the user's own card, and she may have
 *     reasons. Nothing here is ever disabled.
 */
export function ColorPicker({ value, onChange, id }: ColorPickerProps) {
  const { t } = useTranslation();
  const hexFieldId = useId();
  const nativeFieldId = useId();

  // The hex field is a text input, so it holds half-typed values that are not
  // yet a colour. It follows `value` whenever the colour changes elsewhere
  // (a preset click, the OS picker, reopening the modal).
  const [hexDraft, setHexDraft] = useState(value);
  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  const isCustom = value !== '' && !isValidCardColor(value);
  const contrast = isValidHexColor(value) ? getLabelContrast(value) : null;
  const lowContrast = contrast !== null && contrast.ratio < LABEL_CONTRAST_THRESHOLD;

  const commit = (next: string) => {
    if (isValidHexColor(next)) onChange(next.toUpperCase());
  };

  return (
    <div id={id} role="group" aria-label={t('cards.color')} className="flex flex-col gap-3">
      {isCustom && (
        <div className="flex items-center gap-2">
          <button
            key={`current-${value}`}
            type="button"
            aria-label={t('cards.colorCurrent', { hex: value })}
            aria-pressed={true}
            onClick={() => onChange(value)}
            className={cn(SWATCH_CLASS, 'ring-foreground border-white ring-2 ring-offset-2')}
            style={{ backgroundColor: value }}
          />
          <span className="text-muted-foreground text-xs">{t('cards.colorCurrentLabel')}</span>
        </div>
      )}

      <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
        {CARD_COLORS.map((hex) => {
          const isSelected = value === hex;
          return (
            <button
              key={hex}
              type="button"
              aria-label={`color ${hex}`}
              aria-pressed={isSelected}
              onClick={() => onChange(hex)}
              className={cn(
                SWATCH_CLASS,
                isSelected
                  ? 'ring-foreground border-white ring-2 ring-offset-2'
                  : 'border-transparent hover:scale-110',
              )}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={nativeFieldId} className="text-muted-foreground text-xs">
          {t('cards.colorCustom')}
        </label>
        <input
          id={nativeFieldId}
          type="color"
          aria-label={t('cards.colorCustom')}
          value={isValidHexColor(value) ? value : '#000000'}
          onChange={(e) => commit(e.target.value)}
          className={cn(
            'border-input h-9 min-h-[44px] w-12 min-w-[44px] cursor-pointer rounded-md border bg-transparent p-1 sm:min-h-0',
          )}
        />
        <label htmlFor={hexFieldId} className="text-muted-foreground text-xs">
          {t('cards.colorHex')}
        </label>
        <input
          id={hexFieldId}
          type="text"
          inputMode="text"
          spellCheck={false}
          {...noAutofill('cardColorHex')}
          aria-label={t('cards.colorHex')}
          value={hexDraft}
          maxLength={7}
          placeholder="#RRGGBB"
          onChange={(e) => {
            setHexDraft(e.target.value);
            commit(e.target.value);
          }}
          className="border-input focus-visible:ring-ring h-9 min-h-[44px] w-28 rounded-md border px-2 font-mono text-sm focus-visible:ring-2 focus-visible:outline-none sm:min-h-0"
        />
      </div>

      {lowContrast && (
        <p role="status" className="text-muted-foreground text-xs">
          {t('cards.colorContrastWarning', { ratio: contrast.ratio.toFixed(1) })}
        </p>
      )}
    </div>
  );
}

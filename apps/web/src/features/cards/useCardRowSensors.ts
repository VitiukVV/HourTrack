import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * 001-cards-order-colors — the input recipe for the card pill row.
 *
 * Every value here is load-bearing, and none of it is guessable from the
 * outside, which is why it lives in its own hook with its own test rather
 * than inline in `CardsHeader`:
 *
 *   - **MouseSensor, never PointerSensor.** PointerSensor captures touch too
 *     and, with no delay, races TouchSensor for the finger; the browser then
 *     cancels it on scroll and a one-finger drag never starts. Same recipe,
 *     same reason as `features/calendar/useEntryDrag.ts`.
 *   - **`distance: 8` on the mouse** so a click is a click, not a 1px drag.
 *   - **`delay: 220, tolerance: 8` on touch** so a horizontal swipe still
 *     scrolls the row and only a deliberate hold lifts a pill (FR-004).
 *   - **Space picks up, Enter does not.** dnd-kit's default start codes are
 *     [Space, Enter] and its activator calls `preventDefault()`, which on a
 *     real `<button>` also cancels the synthetic click — with the defaults a
 *     chip could be activated by mouse but not by keyboard at all (WCAG
 *     2.1.1), and the Edit/Archive menu only appears once a card IS active,
 *     so there was no keyboard route to it.
 */
export function useCardRowSensors(): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );
}

// Time-of-day helpers: minutes since local midnight <-> `HH:MM` (the native
// `<input type="time">` value format). Used by `TimeInput` and by features that
// print a start time.

/**
 * Convert minutes-since-midnight to a zero-padded `HH:MM` string suitable
 * for the native `<input type="time">` `value` attribute.
 *
 * Values outside `[0, 1439]` are clamped to the nearest in-range value so
 * a stale upstream prop never crashes the input. The caller is responsible
 * for validating with Zod before persisting.
 */
export function minutesToHHMM(minutes: number): string {
  if (!Number.isFinite(minutes)) return '00:00';
  const clamped = Math.max(0, Math.min(1439, Math.trunc(minutes)));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Parse a `HH:MM` string from `<input type="time">` back into minutes
 * since midnight. Returns `null` for empty / unparseable input so the
 * caller can decide whether to fall back to the previous value, surface
 * a validation error, or no-op.
 */
export function parseHHMM(value: string): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

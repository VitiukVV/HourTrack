/**
 * Retry backoff schedule for the SyncManager offline queue.
 *
 * Spec (sprint S10 Notes): `2s, 4s, 8s, 16s, 32s, 60s, 60s, ...` — first
 * attempt is immediate (delay 0). After 5 doublings we cap at 60s and stay
 * there. Cap is reached at attempt #6.
 *
 * Why exponential: a transient 5xx from Drive resolves within seconds;
 * pounding the API at fixed cadence would just burn the rate-limit budget.
 *
 * Why a hard 60s cap: if Drive is fully unavailable, polling once per
 * minute keeps the queue cheap while still picking up the recovery quickly.
 */

const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 60_000;

/**
 * Compute the delay before attempt #`attempts + 1`. `attempts` is the
 * number of FAILED attempts already made on this row.
 *
 *   attempts=0  -> 2_000 ms (first retry after the very first failure)
 *   attempts=1  -> 4_000 ms
 *   attempts=2  -> 8_000 ms
 *   attempts=3  -> 16_000 ms
 *   attempts=4  -> 32_000 ms
 *   attempts>=5 -> 60_000 ms (cap)
 *
 * The first attempt itself isn't retried by this function — callers
 * dispatch the row immediately when `nextAttemptAt === 0`, and only invoke
 * `nextRetryDelay` AFTER a failure.
 */
export function nextRetryDelay(attempts: number): number {
  if (attempts < 0 || !Number.isFinite(attempts)) {
    return BASE_DELAY_MS;
  }
  const doublings = Math.floor(attempts);
  const delay = BASE_DELAY_MS * 2 ** doublings;
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * Convenience: produce the full schedule for the first `count` retries.
 * Used by tests + dev-mode debugging.
 */
export function retrySchedule(count: number): number[] {
  return Array.from({ length: count }, (_, i) => nextRetryDelay(i));
}

export const RETRY_BASE_DELAY_MS = BASE_DELAY_MS;
export const RETRY_MAX_DELAY_MS = MAX_DELAY_MS;

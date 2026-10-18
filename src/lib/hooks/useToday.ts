import { useEffect, useState } from 'react';

/**
 * Today's date, kept fresh across the midnight boundary.
 *
 * The calendar surfaces used `useMemo(() => new Date(), [])`, which freezes
 * "today" at mount: a tab left open overnight (or a PWA resumed the next
 * morning) kept ringing YESTERDAY's cell until something changed the anchor.
 *
 * Two triggers, because neither alone is reliable:
 *   - a timer armed for the next local midnight — handles an app left open;
 *   - `visibilitychange` — a background tab's timers are throttled and a
 *     suspended device doesn't fire them at all, so we re-check whenever the
 *     tab comes back to the foreground.
 *
 * The returned reference only changes when the calendar DAY changes, so it
 * stays safe as a `useMemo` / `memo` dependency.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const isSameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    const refresh = () => {
      const now = new Date();
      setToday((prev) => (isSameDay(prev, now) ? prev : now));
    };

    const schedule = () => {
      const now = new Date();
      // One second past midnight, so a timer that fires marginally early
      // still lands on the new day.
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        1,
        0,
      );
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, nextMidnight.getTime() - now.getTime());
    };

    schedule();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return today;
}

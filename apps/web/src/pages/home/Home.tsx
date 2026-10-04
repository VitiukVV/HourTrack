import { CalendarHeader } from '@/features/calendar/CalendarHeader';
import { CalendarSwipeArea } from '@/features/calendar/CalendarSwipeArea';
import { MonthView } from '@/features/calendar/MonthView';
import { WeekView } from '@/features/calendar/WeekView';
import { useCalendarView } from '@/features/calendar/calendarStore';
import { useDefaultViewSync } from '@/features/calendar/useDefaultViewSync';

/**
 * HomePage = the calendar surface. Composes the sticky CalendarHeader on top
 * of either the MonthView or WeekView based on the view-mode held in
 * `useCalendarView`. On mount we run `useDefaultViewSync` once to adopt the
 * `Settings.defaultView` if the user hasn't already toggled within the tab.
 *
 * S33 — the body sits inside `CalendarSwipeArea`, so a horizontal flick pages
 * the visible range (months in month mode, weeks in week mode) exactly like
 * the header's prev/next buttons.
 */
export function HomePage() {
  useDefaultViewSync();
  const mode = useCalendarView((s) => s.mode);

  return (
    <div className="flex flex-col gap-4">
      <CalendarHeader />
      <CalendarSwipeArea>{mode === 'month' ? <MonthView /> : <WeekView />}</CalendarSwipeArea>
    </div>
  );
}

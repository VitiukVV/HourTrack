/**
 * Thin `fetch`-based Google Calendar v3 REST client. Scope is restricted to
 * `auth/calendar.app.created` — ALL operations target the HourTrack
 * app-created calendar, NEVER the user's primary calendar.
 *
 * Authentication: every call takes the access token as a parameter (rather
 * than reading the token store directly) so consumers can pass a freshly
 * refreshed token. Mirrors the `drive.ts` pattern from S10.
 *
 * Error model:
 *   - 200/204     -> resolve normally
 *   - 401         -> throw `CalendarAuthError` (refresh + retry surfaces in
 *                    SyncManager; this layer stays pure)
 *   - 404         -> throw `CalendarNotFoundError` (calendar or event was
 *                    deleted Google-side — caller decides whether to
 *                    re-create the calendar or treat the event as already
 *                    gone)
 *   - 410         -> throw `CalendarNotFoundError` (event was previously
 *                    deleted; Google sometimes returns 410 Gone instead of
 *                    404 for explicitly DELETEd events)
 *   - other       -> throw `CalendarApiError`
 */

export const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3' as const;

/** Calendar list entry as returned by `calendarList.list`. */
export interface CalendarListEntry {
  id: string;
  summary: string;
}

/** Single event payload — minimal shape needed by HourTrack. */
export interface CalendarEventInput {
  summary: string;
  /** All-day event start. */
  start: { date: string };
  /** All-day event end (exclusive — `date + 1 day`). */
  end: { date: string };
  description: string;
  /** Google's named colorId, `'1'`..`'11'`. */
  colorId: string;
}

/** Event response — `id` is what we persist as `Entry.googleEventId`. */
export interface CalendarEventResponse {
  id: string;
  summary?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  htmlLink?: string;
}

export class CalendarApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: string,
  ) {
    super(`Calendar API error ${status} ${statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'CalendarApiError';
  }
}

export class CalendarAuthError extends CalendarApiError {
  constructor(body?: string) {
    super(401, 'Unauthorized', body);
    this.name = 'CalendarAuthError';
  }
}

/**
 * Thrown for BOTH 404 (calendar / event not found) and 410 (event was
 * previously deleted). Callers want to react to both identically: "the
 * remote resource is gone, decide whether to recreate or accept the gap".
 */
export class CalendarNotFoundError extends CalendarApiError {
  constructor(status: number, body?: string) {
    super(status, status === 410 ? 'Gone' : 'Not Found', body);
    this.name = 'CalendarNotFoundError';
  }
}

interface CalendarCallOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function rejectFromResponse(res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  if (res.status === 401) throw new CalendarAuthError(body);
  if (res.status === 404 || res.status === 410) {
    throw new CalendarNotFoundError(res.status, body);
  }
  throw new CalendarApiError(res.status, res.statusText, body);
}

/**
 * List calendars accessible to the OAuth client. Under
 * `calendar.app.created` scope this returns ONLY calendars the app itself
 * created (Google enforces this — the scope cannot read primary or
 * user-created calendars).
 */
export async function listCalendars(opts: CalendarCallOptions): Promise<CalendarListEntry[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${CALENDAR_API_BASE}/users/me/calendarList`);
  url.searchParams.set('fields', 'items(id,summary)');
  url.searchParams.set('maxResults', '250');
  const res = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: authHeaders(opts.accessToken),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const body = (await res.json()) as { items?: CalendarListEntry[] };
  return body.items ?? [];
}

/**
 * Create a new calendar with the given summary. Used once on first sync —
 * `ensureCalendar` is the canonical entry point and caches the resulting id
 * in `Settings.hourtrackCalendarId`.
 */
export async function createCalendar(
  input: { summary: string; description?: string; timeZone?: string },
  opts: CalendarCallOptions,
): Promise<CalendarListEntry> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${CALENDAR_API_BASE}/calendars`);
  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      ...authHeaders(opts.accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      timeZone: input.timeZone,
    }),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  const body = (await res.json()) as CalendarListEntry;
  // Defensive: Calendar API has been known to return `id` without `summary`
  // on some account configurations. Fall back to the requested summary.
  return { id: body.id, summary: body.summary ?? input.summary };
}

/**
 * Insert (create) an event in the given calendar. Returns the new event's
 * id — callers persist it as `Entry.googleEventId` so future PATCH/DELETE
 * calls can target it.
 *
 * If the calendar itself has been deleted Google-side, this returns 404 —
 * the handler layer detects this and re-runs `ensureCalendar` to recreate
 * the calendar before retrying the insert.
 */
export async function insertEvent(
  calendarId: string,
  event: CalendarEventInput,
  opts: CalendarCallOptions,
): Promise<CalendarEventResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`);
  const res = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: {
      ...authHeaders(opts.accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  return (await res.json()) as CalendarEventResponse;
}

/**
 * Patch an existing event. Uses PATCH (not PUT) so unspecified fields are
 * preserved — important if a future event field is added without bumping
 * this client.
 */
export async function patchEvent(
  calendarId: string,
  eventId: string,
  patch: Partial<CalendarEventInput>,
  opts: CalendarCallOptions,
): Promise<CalendarEventResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(
      calendarId,
    )}/events/${encodeURIComponent(eventId)}`,
  );
  const res = await fetchImpl(url.toString(), {
    method: 'PATCH',
    headers: {
      ...authHeaders(opts.accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    return rejectFromResponse(res);
  }
  return (await res.json()) as CalendarEventResponse;
}

/**
 * Delete an event. Idempotent on 404/410 (already gone — that's fine; the
 * caller's goal of "this event must not exist remotely" is satisfied).
 */
export async function deleteEvent(
  calendarId: string,
  eventId: string,
  opts: CalendarCallOptions,
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(
      calendarId,
    )}/events/${encodeURIComponent(eventId)}`,
  );
  const res = await fetchImpl(url.toString(), {
    method: 'DELETE',
    headers: authHeaders(opts.accessToken),
  });
  // Calendar returns 204 No Content on success.
  if (res.status === 204) return;
  // Treat 404 + 410 as idempotent: event is already gone.
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) {
    return rejectFromResponse(res);
  }
}

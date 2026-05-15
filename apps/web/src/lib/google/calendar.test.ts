import { describe, expect, it } from 'vitest';

import {
  CalendarApiError,
  CalendarAuthError,
  CalendarNotFoundError,
  createCalendar,
  deleteEvent,
  insertEvent,
  listCalendars,
  patchEvent,
} from './calendar';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function plainResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('calendar client', () => {
  describe('listCalendars', () => {
    it('returns the items array on success', async () => {
      const calls: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(input.toString());
        return jsonResponse(200, {
          items: [
            { id: 'cal-1', summary: 'HourTrack' },
            { id: 'cal-2', summary: 'Other' },
          ],
        });
      }) as typeof fetch;
      const result = await listCalendars({ accessToken: 'tk', fetchImpl });
      expect(result).toHaveLength(2);
      expect(result[0]?.summary).toBe('HourTrack');
      expect(calls[0]).toContain('users/me/calendarList');
    });

    it('returns an empty array when items is missing', async () => {
      const fetchImpl = (async () => jsonResponse(200, {})) as typeof fetch;
      const result = await listCalendars({ accessToken: 'tk', fetchImpl });
      expect(result).toEqual([]);
    });

    it('throws CalendarAuthError on 401', async () => {
      const fetchImpl = (async () => plainResponse(401, 'no')) as typeof fetch;
      await expect(listCalendars({ accessToken: 'tk', fetchImpl })).rejects.toBeInstanceOf(
        CalendarAuthError,
      );
    });
  });

  describe('createCalendar', () => {
    it('POSTs the summary and returns the new id + summary', async () => {
      let captured: { url: string; init: RequestInit | undefined } | null = null;
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = { url: input.toString(), init };
        return jsonResponse(200, { id: 'cal-new', summary: 'HourTrack' });
      }) as typeof fetch;
      const result = await createCalendar(
        { summary: 'HourTrack' },
        { accessToken: 'tk', fetchImpl },
      );
      expect(result).toEqual({ id: 'cal-new', summary: 'HourTrack' });
      expect(captured!.init?.method).toBe('POST');
      expect(JSON.parse(captured!.init!.body as string)).toMatchObject({ summary: 'HourTrack' });
    });

    it('falls back to the requested summary when the response omits it', async () => {
      const fetchImpl = (async () => jsonResponse(200, { id: 'cal-x' })) as typeof fetch;
      const result = await createCalendar(
        { summary: 'HourTrack' },
        { accessToken: 'tk', fetchImpl },
      );
      expect(result.summary).toBe('HourTrack');
    });

    it('throws CalendarApiError on 500', async () => {
      const fetchImpl = (async () => plainResponse(500, 'boom')) as typeof fetch;
      await expect(
        createCalendar({ summary: 'X' }, { accessToken: 'tk', fetchImpl }),
      ).rejects.toBeInstanceOf(CalendarApiError);
    });
  });

  describe('insertEvent', () => {
    it('POSTs the event body to the calendar events collection', async () => {
      let capturedBody: string | undefined;
      const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return jsonResponse(200, { id: 'evt-new', summary: 'X' });
      }) as typeof fetch;
      const result = await insertEvent(
        'cal-1',
        {
          summary: 'Raquel | 2H 45M | 36 EUR',
          start: { date: '2026-05-15' },
          end: { date: '2026-05-16' },
          description: 'desc',
          colorId: '11',
        },
        { accessToken: 'tk', fetchImpl },
      );
      expect(result.id).toBe('evt-new');
      expect(JSON.parse(capturedBody!)).toMatchObject({
        summary: 'Raquel | 2H 45M | 36 EUR',
        start: { date: '2026-05-15' },
        end: { date: '2026-05-16' },
        colorId: '11',
      });
    });

    it('throws CalendarNotFoundError on 404 (calendar deleted)', async () => {
      const fetchImpl = (async () => plainResponse(404, 'gone')) as typeof fetch;
      await expect(
        insertEvent(
          'cal-missing',
          {
            summary: 'x',
            start: { date: '2026-05-15' },
            end: { date: '2026-05-16' },
            description: '',
            colorId: '1',
          },
          { accessToken: 'tk', fetchImpl },
        ),
      ).rejects.toBeInstanceOf(CalendarNotFoundError);
    });
  });

  describe('patchEvent', () => {
    it('PATCHes the event with a partial payload', async () => {
      let captured: { url: string; method?: string; body?: unknown } | null = null;
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        captured = {
          url: input.toString(),
          method: init?.method,
          body: JSON.parse(init?.body as string),
        };
        return jsonResponse(200, { id: 'evt-1', summary: 'New' });
      }) as typeof fetch;
      await patchEvent('cal-1', 'evt-1', { summary: 'New' }, { accessToken: 'tk', fetchImpl });
      expect(captured!.method).toBe('PATCH');
      expect(captured!.url).toContain('/events/evt-1');
      expect(captured!.body).toEqual({ summary: 'New' });
    });

    it('throws CalendarNotFoundError on 404', async () => {
      const fetchImpl = (async () => plainResponse(404, '')) as typeof fetch;
      await expect(
        patchEvent('cal', 'evt', { summary: 'x' }, { accessToken: 'tk', fetchImpl }),
      ).rejects.toBeInstanceOf(CalendarNotFoundError);
    });

    it('throws CalendarNotFoundError on 410 Gone', async () => {
      const fetchImpl = (async () => plainResponse(410, '')) as typeof fetch;
      await expect(
        patchEvent('cal', 'evt', { summary: 'x' }, { accessToken: 'tk', fetchImpl }),
      ).rejects.toBeInstanceOf(CalendarNotFoundError);
    });
  });

  describe('deleteEvent', () => {
    it('resolves on 204', async () => {
      const fetchImpl = (async () => new Response('', { status: 204 })) as typeof fetch;
      await expect(
        deleteEvent('cal-1', 'evt-1', { accessToken: 'tk', fetchImpl }),
      ).resolves.toBeUndefined();
    });

    it('resolves idempotently on 404 (already gone)', async () => {
      const fetchImpl = (async () => plainResponse(404, 'gone')) as typeof fetch;
      await expect(
        deleteEvent('cal-1', 'evt-1', { accessToken: 'tk', fetchImpl }),
      ).resolves.toBeUndefined();
    });

    it('resolves idempotently on 410 Gone', async () => {
      const fetchImpl = (async () => plainResponse(410, '')) as typeof fetch;
      await expect(
        deleteEvent('cal-1', 'evt-1', { accessToken: 'tk', fetchImpl }),
      ).resolves.toBeUndefined();
    });

    it('throws CalendarAuthError on 401', async () => {
      const fetchImpl = (async () => plainResponse(401, '')) as typeof fetch;
      await expect(
        deleteEvent('cal-1', 'evt-1', { accessToken: 'tk', fetchImpl }),
      ).rejects.toBeInstanceOf(CalendarAuthError);
    });
  });
});

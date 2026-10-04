import 'fake-indexeddb/auto';

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReminder } from './queries';
import { HourTrackDB } from './schema';
import { useLiveRead } from './useLiveRead';

/**
 * Spec 006 (FR-001) — the one read primitive: follows the database with no
 * invalidation, never hands out an answer that belongs to an older key, and
 * turns a failing query into `isError` instead of a render crash.
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-live-${Math.random().toString(36).slice(2)}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

const reminder = (text: string) => ({
  id: 'r1',
  text,
  dueDate: '2026-10-04',
  dueMinutes: 600,
  doneAt: null,
  googleEventId: null,
  syncStatus: 'pending' as const,
  syncError: null,
  notifiedAt: null,
});

describe('useLiveRead', () => {
  it('re-reads after a write made outside any hook', async () => {
    const { result } = renderHook(() => useLiveRead('all', () => db.reminders.count()));
    await waitFor(() => expect(result.current.data).toBe(0));
    expect(result.current).toMatchObject({ isLoading: false, isSuccess: true, isError: false });

    await createReminder(db, reminder('Pay rent'));

    await waitFor(() => expect(result.current.data).toBe(1));
  });

  it('reports loading — not the previous answer — while a new key loads', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { result, rerender } = renderHook(
      ({ key }) =>
        useLiveRead(key, async () => {
          if (key === 'b') await gate;
          return key;
        }),
      { initialProps: { key: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toBe('a'));

    rerender({ key: 'b' });
    expect(result.current).toMatchObject({ data: undefined, isLoading: true, isSuccess: false });

    release();
    await waitFor(() => expect(result.current.data).toBe('b'));
  });

  it('turns a failing query into isError and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useLiveRead('boom', () => Promise.reject(new Error('boom'))),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.data).toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it('does nothing while disabled — not loading, no data', () => {
    const query = vi.fn(() => Promise.resolve(1));
    const { result } = renderHook(() => useLiveRead('off', query, false));
    expect(result.current).toMatchObject({ data: undefined, isLoading: false, isSuccess: false });
    expect(query).not.toHaveBeenCalled();
  });
});

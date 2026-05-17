import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as dbModule from '@/lib/db';
import { HourTrackDB, createCard, initDB, type SettingsRow } from '@/lib/db';
import type { Card } from '@hourtrack/shared-types';

import {
  useAllCardsQuery,
  useArchiveCardMutation,
  useArchivedCardsQuery,
  useCardsQuery,
  useCreateCardMutation,
  useRestoreCardMutation,
  useUpdateCardMutation,
} from './useCards';

// Replace the singleton db with a per-test fresh instance.
let testDb: HourTrackDB;

type DbModule = typeof dbModule;

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<DbModule>();
  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

function wrapper() {
  // Fresh QueryClient per test → no cache leakage.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeCardInput(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Card',
    color: '#2563EB',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  };
}

beforeEach(async () => {
  testDb = new HourTrackDB(`hourtrack-hooks-${Math.random().toString(36).slice(2)}`);
  await testDb.open();
  await initDB(testDb);
});

afterEach(async () => {
  await testDb.delete();
});

describe('useCardsQuery', () => {
  it('returns only non-archived cards by default', async () => {
    await createCard(testDb, makeCardInput({ name: 'Active' }));
    await createCard(
      testDb,
      makeCardInput({ name: 'Archived', isArchived: true, archivedAt: new Date().toISOString() }),
    );

    const { result } = renderHook(() => useCardsQuery(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.name).toBe('Active');
  });
});

describe('useArchivedCardsQuery', () => {
  it('returns only archived cards', async () => {
    await createCard(testDb, makeCardInput({ name: 'Active' }));
    await createCard(
      testDb,
      makeCardInput({ name: 'Archived', isArchived: true, archivedAt: new Date().toISOString() }),
    );

    const { result } = renderHook(() => useArchivedCardsQuery(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.name).toBe('Archived');
  });
});

describe('useCreateCardMutation', () => {
  it('creates a card and refreshes useCardsQuery', async () => {
    const W = wrapper();
    const created = renderHook(() => useCreateCardMutation(), { wrapper: W });
    const list = renderHook(() => useCardsQuery(), { wrapper: W });

    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(list.result.current.data).toHaveLength(0);

    await act(async () => {
      await created.result.current.mutateAsync(makeCardInput({ name: 'Created' }));
    });

    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    expect(list.result.current.data?.[0]?.name).toBe('Created');
  });
});

describe('useUpdateCardMutation', () => {
  // Note: the happy-path "rename a card" assertion is covered by the
  // `useUpdateCardMutation cache write-through` block further down, which
  // checks the same patch by reading the cache directly. The earlier version
  // here observed the rename through a mounted `useCardsQuery` subscriber
  // under `waitFor`, which was a flaky stand-in for react-query's pubsub
  // (library code) and tipped over under turbo parallel load.

  // ---------- S16b non-cascade rule for defaultStartMinutes ----------
  // We assert by spying on `SyncManager.enqueue` rather than inspecting the
  // Dexie `syncQueue` store, because the manager's `enqueue` short-circuits
  // when no access token is set (S13 anonymous-user gate) — the actual
  // Dexie write never happens in this test environment, but the `enqueue`
  // call DOES happen, and the spy captures the `op` field which is what
  // the cascade rule actually controls.

  it('S16b: defaultStartMinutes-only patch does NOT enqueue bulkUpdateCardEvents', async () => {
    const { getSyncManager } = await import('@/features/sync/SyncManager');
    const mgr = getSyncManager();
    const spy = vi.spyOn(mgr, 'enqueue');

    const card = await createCard(testDb, makeCardInput({ defaultStartMinutes: 600 }));
    const W = wrapper();
    const upd = renderHook(() => useUpdateCardMutation(), { wrapper: W });

    await act(async () => {
      await upd.result.current.mutateAsync({
        id: card.id,
        patch: { defaultStartMinutes: 540 }, // 09:00
      });
    });

    // Allow fire-and-forget enqueues to land.
    await new Promise((r) => setTimeout(r, 25));

    const bulkCalls = spy.mock.calls.filter((c) => c[0]?.op === 'bulkUpdateCardEvents');
    expect(bulkCalls).toHaveLength(0);

    spy.mockRestore();
  });

  it('S16b: name change still enqueues bulkUpdateCardEvents (unchanged cascade)', async () => {
    const { getSyncManager } = await import('@/features/sync/SyncManager');
    const mgr = getSyncManager();
    const spy = vi.spyOn(mgr, 'enqueue');

    const card = await createCard(testDb, makeCardInput({ name: 'OldName' }));
    const W = wrapper();
    const upd = renderHook(() => useUpdateCardMutation(), { wrapper: W });

    await act(async () => {
      await upd.result.current.mutateAsync({
        id: card.id,
        patch: { name: 'NewName' },
      });
    });

    await waitFor(() => {
      const bulkCalls = spy.mock.calls.filter((c) => c[0]?.op === 'bulkUpdateCardEvents');
      expect(bulkCalls).toHaveLength(1);
      expect(bulkCalls[0]?.[0].entityId).toBe(card.id);
    });

    spy.mockRestore();
  });

  it('S16b: name + defaultStartMinutes together still cascade (any event-rendering field triggers)', async () => {
    const { getSyncManager } = await import('@/features/sync/SyncManager');
    const mgr = getSyncManager();
    const spy = vi.spyOn(mgr, 'enqueue');

    const card = await createCard(
      testDb,
      makeCardInput({ name: 'OldBoth', defaultStartMinutes: 600 }),
    );
    const W = wrapper();
    const upd = renderHook(() => useUpdateCardMutation(), { wrapper: W });

    await act(async () => {
      await upd.result.current.mutateAsync({
        id: card.id,
        patch: { name: 'NewBoth', defaultStartMinutes: 540 },
      });
    });

    await waitFor(() => {
      const bulkCalls = spy.mock.calls.filter((c) => c[0]?.op === 'bulkUpdateCardEvents');
      expect(bulkCalls).toHaveLength(1);
    });

    spy.mockRestore();
  });

  it('S16b: patch carrying name=same value (no real change) does NOT cascade', async () => {
    // Guards the diff-against-existing branch: a caller that submits the
    // whole form (name unchanged) alongside a `defaultStartMinutes` change
    // must not trigger a spurious bulk PATCH.
    const { getSyncManager } = await import('@/features/sync/SyncManager');
    const mgr = getSyncManager();
    const spy = vi.spyOn(mgr, 'enqueue');

    const card = await createCard(
      testDb,
      makeCardInput({ name: 'Same', defaultStartMinutes: 600 }),
    );
    const W = wrapper();
    const upd = renderHook(() => useUpdateCardMutation(), { wrapper: W });

    await act(async () => {
      await upd.result.current.mutateAsync({
        id: card.id,
        patch: { name: 'Same', defaultStartMinutes: 540 }, // name identical
      });
    });

    await new Promise((r) => setTimeout(r, 25));

    const bulkCalls = spy.mock.calls.filter((c) => c[0]?.op === 'bulkUpdateCardEvents');
    expect(bulkCalls).toHaveLength(0);

    spy.mockRestore();
  });
});

describe('useArchiveCardMutation', () => {
  it('soft-deletes a card and removes it from useCardsQuery', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'ToArchive' }));
    const W = wrapper();
    const archive = renderHook(() => useArchiveCardMutation(), { wrapper: W });
    const active = renderHook(() => useCardsQuery(), { wrapper: W });
    const archived = renderHook(() => useArchivedCardsQuery(), { wrapper: W });

    await waitFor(() => expect(active.result.current.isSuccess).toBe(true));
    expect(active.result.current.data).toHaveLength(1);

    await act(async () => {
      await archive.result.current.mutateAsync(card.id);
    });

    await waitFor(() => expect(active.result.current.data).toHaveLength(0));
    await waitFor(() => expect(archived.result.current.data).toHaveLength(1));
  });
});

describe('useRestoreCardMutation', () => {
  it('moves a card from archived to active list', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({ name: 'ToRestore', isArchived: true, archivedAt: new Date().toISOString() }),
    );
    const W = wrapper();
    const restore = renderHook(() => useRestoreCardMutation(), { wrapper: W });
    const active = renderHook(() => useCardsQuery(), { wrapper: W });
    const archived = renderHook(() => useArchivedCardsQuery(), { wrapper: W });

    await waitFor(() => expect(archived.result.current.isSuccess).toBe(true));
    expect(archived.result.current.data).toHaveLength(1);

    await act(async () => {
      await restore.result.current.mutateAsync(card.id);
    });

    await waitFor(() => expect(archived.result.current.data).toHaveLength(0));
    await waitFor(() => expect(active.result.current.data).toHaveLength(1));
  });
});

describe('useAllCardsQuery', () => {
  it('returns active + archived cards together when includeArchived is true', async () => {
    await createCard(testDb, makeCardInput({ name: 'Active' }));
    await createCard(
      testDb,
      makeCardInput({ name: 'Archived', isArchived: true, archivedAt: new Date().toISOString() }),
    );

    const { result } = renderHook(() => useAllCardsQuery(true), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    const names = result.current.data?.map((c) => c.name).sort();
    expect(names).toEqual(['Active', 'Archived']);
  });

  it('returns only active cards when includeArchived is false', async () => {
    await createCard(testDb, makeCardInput({ name: 'Active' }));
    await createCard(
      testDb,
      makeCardInput({ name: 'Archived', isArchived: true, archivedAt: new Date().toISOString() }),
    );

    const { result } = renderHook(() => useAllCardsQuery(false), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.name).toBe('Active');
  });
});

// Bug fix regression: card mutations must invalidate the `['entries','range']`
// prefix so the `cardsById` snapshot embedded in useEntriesInRange /
// useReportData stays in sync. Without this, a freshly-created card the user
// immediately activates would not appear in the day-click flow's lookup map
// and `dayClickAction` would fall back to `open-picker` even though a card
// IS active. Spying on `invalidateQueries` is more reliable than seeding
// cache entries — the latter race against gc + observer-less cleanup.
describe('card mutations invalidate entries-range queries', () => {
  function setup() {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0 },
        mutations: { retry: false },
      },
    });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    return { qc, spy, Wrapper };
  }

  function rangeInvalidated(spy: ReturnType<typeof setup>['spy']): boolean {
    return spy.mock.calls.some((call) => {
      const arg = call[0] as { queryKey?: unknown[] } | undefined;
      if (!arg || !Array.isArray(arg.queryKey)) return false;
      return arg.queryKey[0] === 'entries' && arg.queryKey[1] === 'range';
    });
  }

  it('useCreateCardMutation invalidates `[entries, range]`', async () => {
    const { spy, Wrapper } = setup();
    const created = renderHook(() => useCreateCardMutation(), { wrapper: Wrapper });

    await act(async () => {
      await created.result.current.mutateAsync(makeCardInput({ name: 'Fresh' }));
    });

    expect(rangeInvalidated(spy)).toBe(true);
  });

  it('useUpdateCardMutation invalidates `[entries, range]`', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'A' }));
    const { spy, Wrapper } = setup();
    const upd = renderHook(() => useUpdateCardMutation(), { wrapper: Wrapper });

    await act(async () => {
      await upd.result.current.mutateAsync({ id: card.id, patch: { name: 'B' } });
    });

    expect(rangeInvalidated(spy)).toBe(true);
  });

  it('useArchiveCardMutation invalidates `[entries, range]`', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'A' }));
    const { spy, Wrapper } = setup();
    const archive = renderHook(() => useArchiveCardMutation(), { wrapper: Wrapper });

    await act(async () => {
      await archive.result.current.mutateAsync(card.id);
    });

    expect(rangeInvalidated(spy)).toBe(true);
  });

  it('useRestoreCardMutation invalidates `[entries, range]`', async () => {
    const card = await createCard(
      testDb,
      makeCardInput({ name: 'A', isArchived: true, archivedAt: new Date().toISOString() }),
    );
    const { spy, Wrapper } = setup();
    const restore = renderHook(() => useRestoreCardMutation(), { wrapper: Wrapper });

    await act(async () => {
      await restore.result.current.mutateAsync(card.id);
    });

    expect(rangeInvalidated(spy)).toBe(true);
  });
});

// Bug fix regression: useUpdateCardMutation MUST write the updated row
// straight into the cards-list cache (`setQueryData`) BEFORE invalidating.
// Without this, reopening the edit modal immediately after saving shows
// the pre-edit values — react-hook-form reads defaultValues at mount, and
// the background refetch from `invalidateQueries` hasn't resolved yet.
describe('useUpdateCardMutation cache write-through (modal reopen freshness)', () => {
  it('cards-list cache reflects the patch BEFORE the refetch completes', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Old' }));
    const qc = new QueryClient({
      defaultOptions: {
        // gcTime: Infinity → observer-less cache entries (seeded via setQueryData,
        // or written by onSuccess) must persist through the test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    // Seed the active-list cache with the pre-edit snapshot, mirroring what
    // `useCardsQuery` would have done at mount time.
    qc.setQueryData<Card[]>(['cards', 'active'], [card]);
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    const upd = renderHook(() => useUpdateCardMutation(), { wrapper: Wrapper });

    await act(async () => {
      await upd.result.current.mutateAsync({ id: card.id, patch: { name: 'New' } });
    });

    // Immediately after mutateAsync resolves, the cache must already carry
    // the new name. Read directly — we are not waiting for any refetch.
    const cached = qc.getQueryData<Card[]>(['cards', 'active']);
    expect(cached?.[0]?.name).toBe('New');
  });

  it('by-id detail cache reflects the patch synchronously', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Old' }));
    const qc = new QueryClient({
      defaultOptions: {
        // gcTime: Infinity → observer-less cache entries (seeded via setQueryData,
        // or written by onSuccess) must persist through the test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    const upd = renderHook(() => useUpdateCardMutation(), { wrapper: Wrapper });

    await act(async () => {
      await upd.result.current.mutateAsync({ id: card.id, patch: { name: 'New' } });
    });

    const cached = qc.getQueryData<Card>(['cards', 'by-id', card.id]);
    expect(cached?.name).toBe('New');
  });
});

describe('useCreateCardMutation cache write-through (chip-then-day-click freshness)', () => {
  it('active-list cache contains the new card synchronously', async () => {
    const qc = new QueryClient({
      defaultOptions: {
        // gcTime: Infinity → observer-less cache entries (seeded via setQueryData,
        // or written by onSuccess) must persist through the test.
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    // Empty active-list cache (mirrors fresh app load).
    qc.setQueryData<Card[]>(['cards', 'active'], []);
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    const created = renderHook(() => useCreateCardMutation(), { wrapper: Wrapper });

    await act(async () => {
      await created.result.current.mutateAsync(makeCardInput({ name: 'Fresh' }));
    });

    const cached = qc.getQueryData<Card[]>(['cards', 'active']);
    expect(cached?.length).toBe(1);
    expect(cached?.[0]?.name).toBe('Fresh');
  });
});

// Touch SettingsRow type to keep imports satisfied if shake-tree changes.
export type _SettingsRow = SettingsRow;

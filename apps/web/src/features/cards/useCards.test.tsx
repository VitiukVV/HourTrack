import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from 'sonner';

import type * as dbModule from '@/lib/db';
import {
  HourTrackDB,
  createCard,
  getCardsOrdered,
  initDB,
  reorderCard,
  type SettingsRow,
} from '@/lib/db';
import type { Card } from '@hourtrack/shared-types';

import { useEntriesInRange } from '@/features/entries/useEntriesInRange';

import {
  _resetPendingMoveForTesting,
  useAllCardsQuery,
  useArchiveCardMutation,
  useArchivedCardsQuery,
  useCardQuery,
  useCardsQuery,
  useCreateCardMutation,
  useReorderCardsMutation,
  useRestoreCardMutation,
  useUpdateCardMutation,
} from './useCards';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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
    position: 0,
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

// Spec 006 — card writes reach every mounted read with no invalidation. These
// replace the old cache-plumbing assertions; the user-visible regressions they
// guarded stay covered:
//   - a just-created card must be in the calendar's `cardsById` at once, or
//     `dayClickAction` falls back to `open-picker` though a card IS active;
//   - a reopened edit modal must see the saved values (RHF reads
//     defaultValues once, at mount).
describe('card writes reach every mounted read', () => {
  it('a new card appears in the calendar range cardsById', async () => {
    const W = wrapper();
    const range = renderHook(() => useEntriesInRange({ mode: 'week', anchorDate: '2026-05-14' }), {
      wrapper: W,
    });
    const create = renderHook(() => useCreateCardMutation(), { wrapper: W });
    await waitFor(() => expect(range.result.current.isSuccess).toBe(true));

    let created!: Card;
    await act(async () => {
      created = await create.result.current.mutateAsync(makeCardInput({ name: 'Fresh' }));
    });

    await waitFor(() =>
      expect(range.result.current.data?.cardsById.get(created.id)?.name).toBe('Fresh'),
    );
  });

  it('an edit shows in the list and by-id reads a reopened modal mounts from', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'Old' }));
    const W = wrapper();
    const list = renderHook(() => useCardsQuery(), { wrapper: W });
    const byId = renderHook(() => useCardQuery(card.id), { wrapper: W });
    const upd = renderHook(() => useUpdateCardMutation(), { wrapper: W });
    await waitFor(() => expect(byId.result.current.data?.name).toBe('Old'));

    await act(async () => {
      await upd.result.current.mutateAsync({ id: card.id, patch: { name: 'New' } });
    });

    await waitFor(() => {
      expect(list.result.current.data?.[0]?.name).toBe('New');
      expect(byId.result.current.data?.name).toBe('New');
    });
  });

  it('archive and restore move the card between the active and archived reads', async () => {
    const card = await createCard(testDb, makeCardInput({ name: 'A' }));
    const W = wrapper();
    const active = renderHook(() => useCardsQuery(), { wrapper: W });
    const archived = renderHook(() => useArchivedCardsQuery(), { wrapper: W });
    const archive = renderHook(() => useArchiveCardMutation(), { wrapper: W });
    const restore = renderHook(() => useRestoreCardMutation(), { wrapper: W });
    await waitFor(() => expect(active.result.current.data).toHaveLength(1));

    await act(async () => {
      await archive.result.current.mutateAsync(card.id);
    });
    await waitFor(() => {
      expect(active.result.current.data).toHaveLength(0);
      expect(archived.result.current.data?.map((c) => c.id)).toEqual([card.id]);
    });

    await act(async () => {
      await restore.result.current.mutateAsync(card.id);
    });
    await waitFor(() => expect(active.result.current.data?.map((c) => c.id)).toEqual([card.id]));
  });
});

// ---------------------------------------------------------------------------
// 001-cards-order-colors — useReorderCardsMutation
//
// The regression that matters most: a reorder must not enqueue
// `bulkUpdateCardEvents`. That op PATCHes every Calendar event of the card,
// and firing it on every drag would spend the user's API budget rewriting
// events whose content did not change.
// ---------------------------------------------------------------------------

describe('useReorderCardsMutation', () => {
  /** Cards A, B, C at the canonical spacing. */
  async function seedRow(): Promise<Card[]> {
    return [
      await createCard(testDb, makeCardInput({ id: 'c-a', name: 'A', position: 0 })),
      await createCard(testDb, makeCardInput({ id: 'c-b', name: 'B', position: 1024 })),
      await createCard(testDb, makeCardInput({ id: 'c-c', name: 'C', position: 2048 })),
    ];
  }

  const ids = (cards: Card[] | undefined): string[] => (cards ?? []).map((c) => c.id);

  afterEach(() => {
    _resetPendingMoveForTesting();
  });

  it('persists the move through the query layer', async () => {
    await seedRow();
    const reorder = renderHook(() => useReorderCardsMutation(), { wrapper: wrapper() });

    await act(async () => {
      await reorder.result.current.mutateAsync({ cardId: 'c-a', toIndex: 2 });
    });

    const persisted = await getCardsOrdered(testDb);
    expect(persisted.map((c) => c.id)).toEqual(['c-b', 'c-c', 'c-a']);
  });

  it('shows the new order the moment the drop resolves — the chip never snaps back', async () => {
    await seedRow();
    const W = wrapper();
    const list = renderHook(() => useCardsQuery(), { wrapper: W });
    const reorder = renderHook(() => useReorderCardsMutation(), { wrapper: W });
    await waitFor(() => expect(ids(list.result.current.data)).toEqual(['c-a', 'c-b', 'c-c']));

    await act(async () => {
      await reorder.result.current.mutateAsync({ cardId: 'c-c', toIndex: 0 });
    });

    // No waitFor: the pending move is laid over the live list, so the order
    // is right before the live re-read lands.
    expect(ids(list.result.current.data)).toEqual(['c-c', 'c-a', 'c-b']);
  });

  it('lets later writes through once the live list has the move (overlay not stuck)', async () => {
    await seedRow();
    const W = wrapper();
    const list = renderHook(() => useCardsQuery(), { wrapper: W });
    const reorder = renderHook(() => useReorderCardsMutation(), { wrapper: W });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    await act(async () => {
      await reorder.result.current.mutateAsync({ cardId: 'c-c', toIndex: 0 });
    });
    // Another device's move arrives through a sync pull: c-c back to the end.
    await act(async () => {
      await reorderCard(testDb, 'c-c', 2);
    });

    await waitFor(() => expect(ids(list.result.current.data)).toEqual(['c-a', 'c-b', 'c-c']));
  });

  it('enqueues exactly one pushDataJson op for the moved card', async () => {
    const { getSyncManager } = await import('@/features/sync/SyncManager');
    const spy = vi.spyOn(getSyncManager(), 'enqueue');

    await seedRow();
    const reorder = renderHook(() => useReorderCardsMutation(), { wrapper: wrapper() });

    await act(async () => {
      await reorder.result.current.mutateAsync({ cardId: 'c-a', toIndex: 1 });
    });
    await new Promise((r) => setTimeout(r, 25));

    const pushes = spy.mock.calls.filter((c) => c[0]?.op === 'pushDataJson');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.[0].entityId).toBe('c-a');

    spy.mockRestore();
  });

  it('does NOT enqueue bulkUpdateCardEvents — a reorder changes no event', async () => {
    const { getSyncManager } = await import('@/features/sync/SyncManager');
    const spy = vi.spyOn(getSyncManager(), 'enqueue');

    await seedRow();
    const reorder = renderHook(() => useReorderCardsMutation(), { wrapper: wrapper() });

    await act(async () => {
      await reorder.result.current.mutateAsync({ cardId: 'c-a', toIndex: 2 });
    });
    await new Promise((r) => setTimeout(r, 25));

    expect(spy.mock.calls.filter((c) => c[0]?.op === 'bulkUpdateCardEvents')).toHaveLength(0);

    spy.mockRestore();
  });

  it('shows the stored order again and toasts when the write fails', async () => {
    vi.mocked(toast.error).mockClear();
    await seedRow();
    const W = wrapper();
    const list = renderHook(() => useCardsQuery(), { wrapper: W });
    const reorder = renderHook(() => useReorderCardsMutation(), { wrapper: W });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const failing = vi
      .spyOn(await import('@/lib/db'), 'reorderCard')
      .mockRejectedValueOnce(new Error('disk full'));

    await act(async () => {
      await reorder.result.current
        .mutateAsync({ cardId: 'c-c', toIndex: 0 })
        .catch(() => undefined);
    });

    expect(ids(list.result.current.data)).toEqual(['c-a', 'c-b', 'c-c']);
    expect(toast.error).toHaveBeenCalled();
    failing.mockRestore();
  });

  it('places the card in the archived-inclusive list at the slot it really lands in', async () => {
    // `toIndex` is an index into the ACTIVE row. The all-cards list also holds
    // archived cards, so reusing that index would put the chip in the wrong
    // slot there. The move is laid over it next to the neighbour instead.
    await seedRow();
    await createCard(
      testDb,
      makeCardInput({ id: 'c-z', name: 'Z', position: 1536, isArchived: true, archivedAt: 'x' }),
    );
    const W = wrapper();
    const all = renderHook(() => useAllCardsQuery(true), { wrapper: W });
    const reorder = renderHook(() => useReorderCardsMutation(), { wrapper: W });
    await waitFor(() => expect(ids(all.result.current.data)).toEqual(['c-a', 'c-b', 'c-z', 'c-c']));

    await act(async () => {
      await reorder.result.current.mutateAsync({ cardId: 'c-a', toIndex: 2 });
    });

    const persisted = (await getCardsOrdered(testDb, true)).map((c) => c.id);
    expect(ids(all.result.current.data)).toEqual(persisted);
  });

  it('says so when the change cannot be queued for sync', async () => {
    // The write succeeded locally, so the order is right on this device and
    // will never leave it. Staying silent means a green sync indicator and a
    // card order that simply never appears on the other device.
    vi.mocked(toast.error).mockClear();
    const { getSyncManager } = await import('@/features/sync/SyncManager');
    const spy = vi
      .spyOn(getSyncManager(), 'enqueue')
      .mockRejectedValue(new Error('queue write failed'));

    await seedRow();
    const reorder = renderHook(() => useReorderCardsMutation(), { wrapper: wrapper() });

    await act(async () => {
      await reorder.result.current.mutateAsync({ cardId: 'c-a', toIndex: 1 });
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    // The move itself stands — only the sync hand-off failed.
    expect((await getCardsOrdered(testDb)).map((c) => c.id)).toEqual(['c-b', 'c-a', 'c-c']);
    spy.mockRestore();
  });
});

describe('useRestoreCardMutation — failure is visible', () => {
  it('toasts when a restore throws instead of swallowing it', async () => {
    // `ArchivedCardsList` fires this with a bare `void mutateAsync`, so
    // without an onError a failed restore is an unhandled rejection and
    // nothing else: the button flickers, the card stays archived, and
    // retrying does the same thing forever.
    vi.mocked(toast.error).mockClear();
    const W = wrapper();
    const restore = renderHook(() => useRestoreCardMutation(), { wrapper: W });

    await act(async () => {
      await restore.result.current.mutateAsync('c-does-not-exist').catch(() => undefined);
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

// Touch SettingsRow type to keep imports satisfied if shake-tree changes.
export type _SettingsRow = SettingsRow;

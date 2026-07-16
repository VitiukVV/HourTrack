import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entry } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { createCard, createEntry, initDB } from '@/lib/db/queries';

// Mock the Calendar handlers so we test the resync ORCHESTRATION (mode filter,
// create-vs-patch routing, error accumulation, throttle) without real Calendar
// API calls. The handlers themselves own event-shape correctness (covered by
// their own tests).
vi.mock('@/features/sync/handlers/calendarOps', () => ({
  handleCreateCalendarEvent: vi.fn(async () => undefined),
  handleUpdateCalendarEvent: vi.fn(async () => undefined),
}));

import {
  handleCreateCalendarEvent,
  handleUpdateCalendarEvent,
} from '@/features/sync/handlers/calendarOps';
import { runResyncAll } from './resyncAll';

const mockCreate = vi.mocked(handleCreateCalendarEvent);
const mockUpdate = vi.mocked(handleUpdateCalendarEvent);

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-resync-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  mockCreate.mockClear();
  mockUpdate.mockClear();
  mockCreate.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(undefined);
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

async function seedEntry(overrides: Partial<Entry>): Promise<Entry> {
  const card = await createCard(db, {
    id: crypto.randomUUID(),
    name: 'C',
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
  });
  const e = await createEntry(db, {
    id: crypto.randomUUID(),
    cardId: card.id,
    date: '2026-05-14',
    startMinutes: 600,
    durationMin: 120,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
  });
  // Apply post-create overrides (syncStatus / googleEventId) directly.
  if (Object.keys(overrides).length > 0) {
    await db.entries.update(e.id, overrides);
  }
  return { ...e, ...overrides };
}

const noSleep = () => Promise.resolve();

describe('runResyncAll — mode filtering', () => {
  it('only-errored mode visits ONLY entries whose syncStatus !== synced', async () => {
    await seedEntry({ syncStatus: 'synced', googleEventId: 'g1' });
    await seedEntry({ syncStatus: 'error', googleEventId: 'g2' });
    await seedEntry({ syncStatus: 'pending', googleEventId: null });

    const result = await runResyncAll({
      accessToken: 'tk',
      database: db,
      mode: 'only-errored',
      throttleMs: 0,
      sleep: noSleep,
    });

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    // The pending one had no googleEventId → create; the errored one had one → patch.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('all mode visits every entry regardless of syncStatus', async () => {
    await seedEntry({ syncStatus: 'synced', googleEventId: 'g1' });
    await seedEntry({ syncStatus: 'synced', googleEventId: 'g2' });

    const result = await runResyncAll({
      accessToken: 'tk',
      database: db,
      mode: 'all',
      throttleMs: 0,
      sleep: noSleep,
    });

    expect(result.total).toBe(2);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('runResyncAll — create vs patch routing', () => {
  it('routes googleEventId==null to create and a set id to patch', async () => {
    await seedEntry({ syncStatus: 'pending', googleEventId: null });
    await seedEntry({ syncStatus: 'error', googleEventId: 'existing' });

    await runResyncAll({
      accessToken: 'tk',
      database: db,
      mode: 'all',
      throttleMs: 0,
      sleep: noSleep,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('runResyncAll — continue-on-error accounting', () => {
  it('keeps going after a failure and surfaces counts + firstError', async () => {
    await seedEntry({ syncStatus: 'pending', googleEventId: null }); // create → fails
    await seedEntry({ syncStatus: 'error', googleEventId: 'g2' }); // patch → ok
    await seedEntry({ syncStatus: 'error', googleEventId: 'g3' }); // patch → ok

    mockCreate.mockRejectedValueOnce(new Error('boom-create'));

    const result = await runResyncAll({
      accessToken: 'tk',
      database: db,
      mode: 'all',
      throttleMs: 0,
      sleep: noSleep,
    });

    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.firstError).toBe('boom-create');
  });
});

describe('runResyncAll — throttle', () => {
  it('sleeps between items but NOT after the last one', async () => {
    await seedEntry({ syncStatus: 'error', googleEventId: 'g1' });
    await seedEntry({ syncStatus: 'error', googleEventId: 'g2' });
    await seedEntry({ syncStatus: 'error', googleEventId: 'g3' });

    const sleep = vi.fn(() => Promise.resolve());
    await runResyncAll({ accessToken: 'tk', database: db, mode: 'all', throttleMs: 200, sleep });

    // 3 items → 2 inter-item sleeps (skipped after the last).
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it('does not sleep at all when throttleMs is 0', async () => {
    await seedEntry({ syncStatus: 'error', googleEventId: 'g1' });
    await seedEntry({ syncStatus: 'error', googleEventId: 'g2' });

    const sleep = vi.fn(() => Promise.resolve());
    await runResyncAll({ accessToken: 'tk', database: db, mode: 'all', throttleMs: 0, sleep });

    expect(sleep).not.toHaveBeenCalled();
  });
});

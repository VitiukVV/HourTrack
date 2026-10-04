import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DriveSnapshot } from '@hourtrack/shared-types';

import type * as SyncManagerModule from '@/features/sync/SyncManager';

import { HourTrackDB } from '@/lib/db/schema';
import { createCard, getAllCards, initDB } from '@/lib/db/queries';
import { _resetSyncManagerForTesting } from '@/features/sync/SyncManager';
import { enqueueSyncOp } from '@/lib/db/queries';

import { runRestore } from './restoreFlow';

// Spec 009: a test can stand in a manager whose push never lands.
let managerOverride: {
  enqueue: (op: { op: string }) => Promise<void>;
  flushNow: () => Promise<void>;
} | null = null;
vi.mock('@/features/sync/SyncManager', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncManagerModule>();
  return { ...actual, getSyncManager: () => managerOverride ?? actual.getSyncManager() };
});

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-restore-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  _resetSyncManagerForTesting();
});

afterEach(async () => {
  await db.delete();
  _resetSyncManagerForTesting();
  managerOverride = null;
  vi.restoreAllMocks();
});

function makeValidSnapshot(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    // S16: bumped to v2 in lockstep with DriveSnapshot.schemaVersion.
    schemaVersion: 2,
    exportedAt: '2026-05-15T10:00:00.000Z',
    deviceId: '11111111-1111-4111-8111-111111111111',
    settings: {
      language: 'en',
      theme: 'system',
      defaultView: 'month',
      hourtrackCalendarId: null,
      autoBackupEnabled: true,
      autoBackupIntervalDays: 3,
      lastBackupAt: '2026-05-15T10:00:00.000Z',
      lastSyncAt: null,
      firstLoginAt: null,
      deviceId: null,
      driveDataFileId: null,
      driveDataEtag: null,
      onboardingSeen: false,
    },
    cards: [
      {
        id: 'restored-card-1',
        name: 'Restored',
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
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    entries: [],
    tombstones: [],
    ...overrides,
  };
}

interface Stub {
  match: (url: string, init?: RequestInit) => boolean;
  response: () => Response;
}
function makeFetch(stubs: Stub[]): typeof fetch {
  const queue = [...stubs];
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const idx = queue.findIndex((s) => s.match(url, init));
    if (idx === -1) throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    return queue.splice(idx, 1)[0]!.response();
  }) as typeof fetch;
}

/** The Drive calls of a restore that succeeds: download, then the pre-restore backup. */
function successFetch(snapshot: DriveSnapshot): typeof fetch {
  return makeFetch([
    // Step 1: download the snapshot via readJsonFile
    {
      match: (url, init) =>
        url.includes('drive/v3/files') &&
        url.includes('alt=media') &&
        (init?.method ?? 'GET') === 'GET',
      response: () =>
        new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { 'Content-Type': 'application/json', etag: 'etag-x' },
        }),
    },
    // Step 3: pre-restore backup upload
    {
      match: (url, init) =>
        url.includes('upload/drive/v3/files') && (init?.method ?? 'GET') === 'POST',
      response: () =>
        new Response(
          JSON.stringify({
            id: 'pre-restore-id',
            name: 'backups/pre-restore-2026-05-15T120000Z.json',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json', etag: 'etag-pr' } },
        ),
    },
  ]);
}

describe('runRestore', () => {
  it('downloads, validates, wipes, applies, and reports success', async () => {
    // Seed local state that should be REPLACED by the restore.
    await createCard(db, {
      id: 'local-old-card',
      name: 'Will be wiped',
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
    });

    const snapshot = makeValidSnapshot();
    const fetchImpl = successFetch(snapshot);

    const result = await runRestore({
      accessToken: 'token-abc',
      fileId: 'snap-file-id',
      database: db,
      fetchImpl,
      now: new Date('2026-05-15T12:00:00Z'),
    });

    expect(result.outcome).toBe('success');
    expect(result.applied).toEqual({
      cards: 1,
      entries: 0,
      payments: 0,
      reminders: 0,
      tombstones: 0,
    });
    expect(result.safetyBackupCreated).toBe(true);

    // Local cards table should now reflect ONLY the restored row.
    const cards = await getAllCards(db, true);
    expect(cards.map((c) => c.id)).toEqual(['restored-card-1']);
  });

  it('returns invalid + leaves local data untouched when the snapshot fails schema validation', async () => {
    await createCard(db, {
      id: 'preserved-card',
      name: 'Survives',
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
    });
    const fetchImpl = makeFetch([
      {
        match: (url, init) =>
          url.includes('drive/v3/files') &&
          url.includes('alt=media') &&
          (init?.method ?? 'GET') === 'GET',
        response: () =>
          // S16: pre-S16 (v1) snapshot — the validator MUST reject this with
          // the `versionMismatch` code so the modal renders the "older app
          // version" copy. v2 is the only accepted schemaVersion.
          new Response(JSON.stringify({ schemaVersion: 1, cards: [], entries: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', etag: 'etag-x' },
          }),
      },
    ]);

    const result = await runRestore({
      accessToken: 'token-abc',
      fileId: 'bad-file',
      database: db,
      fetchImpl,
    });

    expect(result.outcome).toBe('invalid');
    expect(result.error).toBeTruthy();
    expect(result.validationCode).toBe('versionMismatch');
    const cards = await getAllCards(db, true);
    expect(cards.map((c) => c.id)).toEqual(['preserved-card']);
  });

  it('returns failed when the snapshot download throws', async () => {
    const fetchImpl = (async () => {
      throw new Error('Network down');
    }) as typeof fetch;
    const result = await runRestore({
      accessToken: 'token-abc',
      fileId: 'any',
      database: db,
      fetchImpl,
    });
    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('Network down');
  });

  it('still succeeds when the pre-restore safety backup fails', async () => {
    const snapshot = makeValidSnapshot();
    const fetchImpl = makeFetch([
      {
        match: (url, init) =>
          url.includes('drive/v3/files') &&
          url.includes('alt=media') &&
          (init?.method ?? 'GET') === 'GET',
        response: () =>
          new Response(JSON.stringify(snapshot), {
            status: 200,
            headers: { 'Content-Type': 'application/json', etag: 'etag-x' },
          }),
      },
      // Pre-restore upload errors.
      {
        match: (url, init) =>
          url.includes('upload/drive/v3/files') && (init?.method ?? 'GET') === 'POST',
        response: () =>
          new Response('Server error', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
          }),
      },
    ]);

    const result = await runRestore({
      accessToken: 'token-abc',
      fileId: 'snap',
      database: db,
      fetchImpl,
      now: new Date('2026-05-15T12:00:00Z'),
    });
    expect(result.outcome).toBe('success');
    expect(result.safetyBackupCreated).toBe(false);
  });
});

describe('runRestore — push after restore (spec 009)', () => {
  it('reports the push as pending when data.json was not updated', async () => {
    // A push that never lands: the row stays queued, and `flushNow` (which
    // reports failure through status, not by rejecting) resolves anyway.
    const flushNow = vi.fn(() => Promise.resolve());
    managerOverride = {
      enqueue: async (op) => {
        await enqueueSyncOp(db, op as Parameters<typeof enqueueSyncOp>[1]);
      },
      flushNow,
    };

    const result = await runRestore({
      accessToken: 'token-abc',
      fileId: 'snap-file-id',
      database: db,
      fetchImpl: successFetch(makeValidSnapshot()),
      now: new Date('2026-05-15T12:00:00Z'),
    });

    expect(result.outcome).toBe('success');
    expect(result.pushPending).toBe(true);
    // Drained twice: a flush already in flight may have read the queue
    // before the restore's row existed.
    expect(flushNow).toHaveBeenCalledTimes(2);
  });

  it('is not pending once the push drained the queue', async () => {
    managerOverride = {
      enqueue: async (op) => {
        await enqueueSyncOp(db, op as Parameters<typeof enqueueSyncOp>[1]);
      },
      flushNow: vi.fn(async () => {
        await db.syncQueue.clear();
      }),
    };

    const result = await runRestore({
      accessToken: 'token-abc',
      fileId: 'snap-file-id',
      database: db,
      fetchImpl: successFetch(makeValidSnapshot()),
      now: new Date('2026-05-15T12:00:00Z'),
    });

    expect(result.pushPending).toBe(false);
  });
});

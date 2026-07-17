import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DriveSnapshot } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { initDB } from '@/lib/db/queries';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { runBootstrap } from './bootstrap';
import {
  _resetSnapshotAppliedForTesting,
  emitSnapshotApplied,
  subscribeSnapshotApplied,
} from './snapshotEvents';

/**
 * S29 Blocker #2 / UR-29-2 — after a Drive pull that changed local data, the
 * sync layer emits `snapshot-applied` so the UI can invalidate its caches and
 * render the pulled rows without a manual reload. A pull that changed nothing
 * (`in-sync`) must NOT emit (no wasteful refetch churn).
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-snapevt-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  _resetSnapshotAppliedForTesting();
});

afterEach(async () => {
  await db.delete();
  _resetSnapshotAppliedForTesting();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown, etag = 'etag-1'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', etag },
  });
}

function makeFetchStub(
  responses: Array<{ match: (url: string) => boolean; response: Response }>,
): typeof fetch {
  const queue = [...responses];
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const idx = queue.findIndex((r) => r.match(url));
    if (idx === -1) throw new Error(`Unexpected fetch: ${url}`);
    const [match] = queue.splice(idx, 1);
    return match!.response;
  }) as typeof fetch;
}

function remoteSnapshot(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 5,
    exportedAt: '2026-05-14T00:00:00.000Z',
    deviceId: 'remote-device',
    settings: {
      language: 'en',
      theme: 'system',
      defaultView: 'month',
      hourtrackCalendarId: null,
      autoBackupEnabled: true,
      autoBackupIntervalDays: 3,
      lastBackupAt: null,
      lastSyncAt: null,
      firstLoginAt: null,
      deviceId: 'remote-device',
      driveDataFileId: null,
      driveDataEtag: null,
      onboardingSeen: false,
    },
    cards: [],
    entries: [],
    payments: [],
    reminders: [],
    tombstones: [],
    ...overrides,
  };
}

function readPathStub(snapshot: DriveSnapshot): typeof fetch {
  return makeFetchStub([
    {
      match: (url) =>
        url.includes('drive/v3/files') && !url.includes('upload') && url.includes('q='),
      response: jsonResponse(200, { files: [{ id: 'file-existing', name: 'data.json' }] }),
    },
    {
      match: (url) => url.includes('drive/v3/files/file-existing') && !url.includes('alt=media'),
      response: jsonResponse(
        200,
        { id: 'file-existing', name: 'data.json', modifiedTime: '2026-05-14T00:00:00.000Z' },
        'etag-server',
      ),
    },
    {
      match: (url) => url.includes('drive/v3/files/file-existing') && url.includes('alt=media'),
      response: jsonResponse(200, snapshot, 'etag-server'),
    },
  ]);
}

describe('emitSnapshotApplied / subscribeSnapshotApplied', () => {
  it('invokes subscribers on emit and stops after unsubscribe', () => {
    const spy = vi.fn();
    const unsub = subscribeSnapshotApplied(spy);
    emitSnapshotApplied();
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
    emitSnapshotApplied();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a subscriber throwing does not stop sibling subscribers', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    subscribeSnapshotApplied(bad);
    subscribeSnapshotApplied(good);
    expect(() => emitSnapshotApplied()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('runBootstrap → snapshot-applied emission', () => {
  it('emits when a pull changed local data (differing remote)', async () => {
    const spy = vi.fn();
    subscribeSnapshotApplied(spy);

    const snapshot = remoteSnapshot({
      cards: [
        {
          id: 'remote-card-1',
          name: 'From Remote',
          color: '#2563EB',
          defaultDurationMin: 480,
          defaultStartMinutes: 600,
          rateType: 'hourly',
          hourlyRate: 25,
          fixedTotal: null,
          monthlyTotal: null,
          defaultNote: null,
          isArchived: false,
          archivedAt: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        },
      ],
    });

    await runBootstrap({
      database: db,
      accessToken: 'token-abc',
      grantedScopes: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      fetchImpl: readPathStub(snapshot),
    });

    expect(spy).toHaveBeenCalled();
  });

  it('does NOT emit when the pull found nothing to change (in-sync)', async () => {
    const spy = vi.fn();
    subscribeSnapshotApplied(spy);

    // Local Dexie is empty and the remote snapshot is empty → merge equals
    // both sides → outcome 'in-sync' → no emission.
    await runBootstrap({
      database: db,
      accessToken: 'token-abc',
      grantedScopes: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      fetchImpl: readPathStub(remoteSnapshot()),
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

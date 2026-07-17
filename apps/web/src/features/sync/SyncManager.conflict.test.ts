import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, DriveSnapshot, Settings } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import {
  createCard,
  getAllSyncQueueRows,
  getSettings,
  initDB,
  updateSettings,
} from '@/lib/db/queries';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { SyncManager } from './SyncManager';
import { _resetConflictLog, getConflictLog } from './conflictLog';
import { _resetSnapshotAppliedForTesting, subscribeSnapshotApplied } from './snapshotEvents';

/**
 * S31 Task 9 (UR-31-7, audit P0) — the multi-device convergence path
 * (update → 412 → pull → LWW merge → apply → re-push) was untested
 * end-to-end. These tests pin the orchestration: correct etag on the re-push,
 * no infinite loop on a second 412, conflict + snapshot-applied side effects,
 * and merge-apply preserving a locally-newer row.
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-conflict-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  _resetConflictLog();
  _resetSnapshotAppliedForTesting();
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

function newCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: 'c1',
    name: 'Local name',
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

function remoteSettings(): Settings {
  return {
    language: 'en',
    theme: 'system',
    defaultView: 'month',
    hourtrackCalendarId: null,
    autoBackupEnabled: true,
    autoBackupIntervalDays: 3,
    lastBackupAt: null,
    lastSyncAt: null,
    firstLoginAt: null,
    deviceId: null,
    driveDataFileId: null,
    driveDataEtag: null,
    onboardingSeen: false,
  };
}

function remoteCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    name: 'Remote name',
    color: '#DC2626',
    defaultDurationMin: 480,
    defaultStartMinutes: 600,
    rateType: 'hourly',
    hourlyRate: 30,
    fixedTotal: null,
    monthlyTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2999-01-01T00:00:00.000Z', // far-future → remote wins the LWW
    ...overrides,
  };
}

function remoteSnapshot(cards: Card[]): DriveSnapshot {
  return {
    schemaVersion: 5,
    exportedAt: '2999-01-01T00:00:00.000Z',
    deviceId: 'remote-device',
    settings: remoteSettings(),
    cards,
    entries: [],
    payments: [],
    reminders: [],
    tombstones: [],
  };
}

function jsonResponse(status: number, body: unknown, etag = 'etag-1'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', etag },
  });
}

describe('SyncManager — 412 conflict merge orchestration (S31 / UR-31-7)', () => {
  it('pulls, merges, and re-pushes with the PULLED etag (not the stale one) + fires side effects', async () => {
    await createCard(db, newCard()); // local c1 (older updatedAt)
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: 'etag-stale' });

    const ifMatchOnMediaPatch: Array<string | null> = [];
    let mediaPatchCount = 0;

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;

      // Content write (PATCH upload ... uploadType=media)
      if (url.includes('/upload/drive/v3/files/') && method === 'PATCH') {
        mediaPatchCount += 1;
        ifMatchOnMediaPatch.push(headers['If-Match'] ?? null);
        if (mediaPatchCount === 1) {
          return new Response('precondition', { status: 412 });
        }
        return jsonResponse(200, { id: 'file-1', modifiedTime: 't' }, 'etag-final');
      }
      // Read (GET alt=media) → the remote snapshot with a NEWER c1.
      if (url.includes('/drive/v3/files/') && url.includes('alt=media') && method === 'GET') {
        return jsonResponse(200, remoteSnapshot([remoteCard()]), 'etag-remote');
      }
      // Metadata appProperties PATCH after a successful content write.
      if (url.includes('/drive/v3/files/') && method === 'PATCH') {
        return jsonResponse(200, { appProperties: {} });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }) as typeof fetch;

    let snapshotAppliedFired = 0;
    const unsub = subscribeSnapshotApplied(() => {
      snapshotAppliedFired += 1;
    });

    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      fetchImpl,
      getAccessToken: async () => 'tk',
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });

    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    // Two media PATCHes: the first (412) with the stale etag, the retry with
    // the freshly pulled etag — NOT the stale one.
    expect(mediaPatchCount).toBe(2);
    expect(ifMatchOnMediaPatch[0]).toBe('etag-stale');
    expect(ifMatchOnMediaPatch[1]).toBe('etag-remote');

    // driveDataEtag advanced to the retry's etag; sync succeeded (idle, queue empty).
    const settings = await getSettings(db);
    expect(settings?.driveDataEtag).toBe('etag-final');
    expect(settings?.lastSyncAt).toBeTruthy();
    expect(mgr.getStatus()).toBe('idle');
    expect(await getAllSyncQueueRows(db)).toHaveLength(0);

    // Merge changed local data → snapshot-applied fired; the remote-newer row
    // was recorded as a conflict.
    expect(snapshotAppliedFired).toBeGreaterThanOrEqual(1);
    const conflicts = getConflictLog();
    expect(conflicts.some((c) => c.entityType === 'card' && c.entityId === 'c1')).toBe(true);
    // Merge-apply pulled the remote-newer card into local Dexie.
    const localCard = await db.cards.get('c1');
    expect(localCard?.name).toBe('Remote name');

    unsub();
    mgr.dispose();
  });

  it('a SECOND 412 on the retry surfaces as retryable error and does NOT loop', async () => {
    await createCard(db, newCard());
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: 'etag-stale' });

    let mediaPatchCount = 0;
    let readCount = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? 'GET';
      if (url.includes('/upload/drive/v3/files/') && method === 'PATCH') {
        mediaPatchCount += 1;
        // Both the initial push AND the retry hit 412.
        return new Response('precondition', { status: 412 });
      }
      if (url.includes('/drive/v3/files/') && url.includes('alt=media') && method === 'GET') {
        readCount += 1;
        return jsonResponse(200, remoteSnapshot([remoteCard()]), 'etag-remote');
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }) as typeof fetch;

    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      fetchImpl,
      getAccessToken: async () => 'tk',
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });

    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    // No loop: exactly one pull + exactly two content writes (initial + one retry).
    expect(readCount).toBe(1);
    expect(mediaPatchCount).toBe(2);
    // The second 412 is a real failure → status error, row rescheduled (retryable).
    expect(mgr.getStatus()).toBe('error');
    const rows = await getAllSyncQueueRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts ?? 0).toBeGreaterThanOrEqual(1);

    mgr.dispose();
  });

  it('merge-apply preserves a locally-newer row (local edit not clobbered by an older remote)', async () => {
    // Local c1 is the NEWER version this time.
    await createCard(db, newCard({ name: 'Local newest' }));
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: 'etag-stale' });

    let mediaPatchCount = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = init?.method ?? 'GET';
      if (url.includes('/upload/drive/v3/files/') && method === 'PATCH') {
        mediaPatchCount += 1;
        if (mediaPatchCount === 1) return new Response('precondition', { status: 412 });
        return jsonResponse(200, { id: 'file-1', modifiedTime: 't' }, 'etag-final');
      }
      if (url.includes('/drive/v3/files/') && url.includes('alt=media') && method === 'GET') {
        // Remote c1 is OLDER (2020) than the local row → local must win.
        return jsonResponse(
          200,
          remoteSnapshot([
            remoteCard({ name: 'Remote older', updatedAt: '2020-01-01T00:00:00.000Z' }),
          ]),
          'etag-remote',
        );
      }
      if (url.includes('/drive/v3/files/') && method === 'PATCH') {
        return jsonResponse(200, { appProperties: {} });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }) as typeof fetch;

    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      fetchImpl,
      getAccessToken: async () => 'tk',
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });

    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    const localCard = await db.cards.get('c1');
    expect(localCard?.name).toBe('Local newest');
    expect(mgr.getStatus()).toBe('idle');

    mgr.dispose();
  });
});

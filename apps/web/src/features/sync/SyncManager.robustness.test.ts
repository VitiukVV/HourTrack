import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { createCard, enqueueSyncOp, getAllSyncQueueRows, initDB } from '@/lib/db/queries';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { SyncManager } from './SyncManager';

/**
 * S29 Part B robustness — the SyncManager must (UR-29-3) keep draining rows
 * enqueued during an in-flight flush and never report 'idle' while ready rows
 * remain, and (UR-29-6) surface a hung/aborted request as a normal retryable
 * error instead of getting stuck at 'syncing'.
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-syncrob-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

function newCard(overrides: Partial<Card> = {}): Omit<Card, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    name: 'Test',
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

function jsonResponse(status: number, body: unknown, etag = 'etag-1'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', etag },
  });
}

describe('SyncManager — enqueue during in-flight flush (UR-29-3)', () => {
  it('does not report idle while a mid-flush enqueue leaves a ready row, then drains it', async () => {
    await createCard(db, newCard());

    let injected = false;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('upload/drive/v3/files')) {
        if (!injected) {
          injected = true;
          // A new mutation lands AFTER this run captured its row set.
          await enqueueSyncOp(db, { op: 'pushDataJson' });
        }
        return jsonResponse(200, { id: 'file-new', name: 'data.json' }, 'etag-x');
      }
      // findFile (no cached fileId) + any metadata PATCH.
      return jsonResponse(200, { files: [] });
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

    // The mid-flush row is still queued and ready → status must NOT be idle.
    expect(mgr.getStatus()).toBe('syncing');
    expect(await getAllSyncQueueRows(db)).toHaveLength(1);

    // A follow-up drain clears it (fileId now cached → update path).
    await mgr.flushNow();
    expect(await getAllSyncQueueRows(db)).toHaveLength(0);
    expect(mgr.getStatus()).toBe('idle');

    mgr.dispose();
  });
});

describe('SyncManager — aborted/hung request (UR-29-6)', () => {
  it('surfaces an aborted fetch as a retryable error, not a stuck syncing state', async () => {
    await createCard(db, newCard());

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('upload/drive/v3/files')) {
        // Simulate the 30s AbortSignal.timeout firing on a hung upload.
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return jsonResponse(200, { files: [] });
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

    expect(mgr.getStatus()).toBe('error');
    const rows = await getAllSyncQueueRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.nextAttemptAt ?? 0).toBeGreaterThan(Date.now());

    mgr.dispose();
  });
});

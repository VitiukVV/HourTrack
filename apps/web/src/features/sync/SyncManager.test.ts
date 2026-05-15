import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@hourtrack/shared-types';

import { HourTrackDB } from '@/lib/db/schema';
import { createCard, getAllSyncQueueRows, getSettings, initDB } from '@/lib/db/queries';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { SyncManager } from './SyncManager';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-syncmgr-${Math.random().toString(36).slice(2)}`);
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
    color: '#3B82F6',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
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

interface Stub {
  match: (url: string, init?: RequestInit) => boolean;
  response: Response;
}
function makeFetch(stubs: Stub[]): { fetchImpl: typeof fetch; calls: string[] } {
  const queue = [...stubs];
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const idx = queue.findIndex((s) => s.match(url, init));
    if (idx === -1) throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    return queue.splice(idx, 1)[0]!.response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('SyncManager', () => {
  it('coalesces multiple pushDataJson enqueues into a single Drive write', async () => {
    await createCard(db, newCard({ name: 'A' }));
    // We may need a second create response if a race-flushed row spills over;
    // queue plenty of canned responses.
    const stubs: Stub[] = [];
    for (let i = 0; i < 5; i += 1) {
      stubs.push({
        match: (url) => url.includes('drive/v3/files') && !url.includes('upload'),
        response: jsonResponse(200, { files: [] }),
      });
    }
    for (let i = 0; i < 5; i += 1) {
      stubs.push({
        match: (url) => url.includes('upload/drive/v3/files'),
        response: jsonResponse(200, { id: 'file-new', name: 'data.json' }, 'etag-x'),
      });
    }
    const { fetchImpl, calls } = makeFetch(stubs);

    // Use a larger debounce so all three enqueues coalesce into the SAME
    // pending kick — then `flushNow()` drains them in one Drive write.
    const mgr = new SyncManager({
      database: db,
      debounceMs: 100,
      fetchImpl,
      getAccessToken: async () => 'token-abc',
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });

    // Enqueue 3 pushes — all should coalesce.
    await mgr.enqueue({ op: 'pushDataJson', mutation: 'create', entityType: 'card' });
    await mgr.enqueue({ op: 'pushDataJson', mutation: 'update', entityType: 'card' });
    await mgr.enqueue({ op: 'pushDataJson', mutation: 'update', entityType: 'card' });

    await mgr.flushNow();
    // Only one upload call should have happened.
    const uploadCalls = calls.filter((c) => c.includes('upload/drive/v3/files'));
    expect(uploadCalls).toHaveLength(1);

    // Queue should be empty after success.
    const remaining = await getAllSyncQueueRows(db);
    expect(remaining).toHaveLength(0);

    const settings = await getSettings(db);
    expect(settings?.driveDataFileId).toBe('file-new');
    expect(mgr.getStatus()).toBe('idle');

    mgr.dispose();
  });

  it('returns to error status when push fails + reschedules the row with backoff', async () => {
    await createCard(db, newCard());
    const { fetchImpl } = makeFetch([
      {
        match: (url) => url.includes('drive/v3/files') && !url.includes('upload'),
        response: jsonResponse(200, { files: [] }),
      },
      {
        // create fails with 500
        match: (url) => url.includes('upload/drive/v3/files'),
        response: new Response('boom', { status: 500 }),
      },
    ]);

    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      fetchImpl,
      getAccessToken: async () => 'tk',
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });
    await mgr.enqueue({ op: 'pushDataJson', mutation: 'create' });
    await mgr.flushNow();

    expect(mgr.getStatus()).toBe('error');

    // Row stays in the queue with attempts incremented + nextAttemptAt in the future.
    const rows = await getAllSyncQueueRows(db);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt ?? 0).toBeGreaterThan(Date.now());
    expect(row.lastError).toBeTruthy();

    mgr.dispose();
  });

  it('bails out cleanly when the drive.appdata scope is not granted', async () => {
    await createCard(db, newCard());
    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      // No fetchImpl needed — we should never reach a Drive call.
      getAccessToken: async () => 'tk',
      getGrantedScopes: async () => 'openid email profile',
      attachWindowListeners: false,
    });
    await mgr.enqueue({ op: 'pushDataJson', mutation: 'create' });
    await mgr.flushNow();
    expect(mgr.getStatus()).toBe('error');
    expect(mgr.getLastError()).toMatch(/scope/i);
    // Row remains queued (with attempts not bumped because we never tried)
    const rows = await getAllSyncQueueRows(db);
    expect(rows).toHaveLength(1);
    mgr.dispose();
  });

  it('honors the in-process lock — two concurrent flushes share the same promise', async () => {
    await createCard(db, newCard());
    let createCallCount = 0;
    const { fetchImpl } = makeFetch([
      {
        match: (url) => url.includes('drive/v3/files') && !url.includes('upload'),
        response: jsonResponse(200, { files: [] }),
      },
      {
        match: (url) => url.includes('upload/drive/v3/files'),
        response: jsonResponse(200, { id: 'file-new', name: 'data.json' }, 'etag-y'),
      },
    ]);

    const wrappedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string' && input.includes('upload')) {
        createCallCount += 1;
      } else if (input.toString().includes('upload')) {
        createCallCount += 1;
      }
      return fetchImpl(input, init);
    }) as typeof fetch;

    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      fetchImpl: wrappedFetch,
      getAccessToken: async () => 'tk',
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });
    await mgr.enqueue({ op: 'pushDataJson' });
    // Fire two concurrent flush calls — should share the in-flight promise
    // and result in a single Drive write.
    await Promise.all([mgr.flush(), mgr.flush()]);
    expect(createCallCount).toBeLessThanOrEqual(1);
    mgr.dispose();
  });

  it('subscribes propagate status transitions', async () => {
    // S13 followup: with the anonymous-user enqueue gate the "no access
    // token at enqueue time" path silently drops the op (no queue write,
    // no error). To exercise an actual `error` transition we keep the
    // token at enqueue time but yank it before flush runs — that path
    // legitimately surfaces "No access token" because flush's defensive
    // re-read sees the change.
    let token: string | null = 'tk';
    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      getAccessToken: async () => token,
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });
    const events: string[] = [];
    const unsub = mgr.subscribe((s, _err) => events.push(s));
    expect(events).toContain('idle');
    await mgr.enqueue({ op: 'pushDataJson' });
    token = null;
    await mgr.flushNow();
    // Expect at least one syncing then an error transition (no access token
    // by flush time).
    expect(events).toContain('error');
    unsub();
    mgr.dispose();
  });

  it('S13: anonymous-user enqueue gate drops the op silently', async () => {
    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      getAccessToken: async () => null,
      getGrantedScopes: async () => null,
      attachWindowListeners: false,
    });
    await mgr.enqueue({ op: 'pushDataJson' });
    // Nothing should land in the queue.
    const rows = await db.syncQueue.toArray();
    expect(rows).toHaveLength(0);
    expect(mgr.getStatus()).toBe('idle');
    mgr.dispose();
  });
});

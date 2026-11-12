import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card } from '@/shared/types';

import { HourTrackDB } from '@/lib/db/schema';
import { createCard, getAllSyncQueueRows, getSettings, initDB } from '@/lib/db/queries';
import { SCOPE_CALENDAR_APP_CREATED, SCOPE_DRIVE_APPDATA } from '@/lib/google/config';
import { SUPPORTED_SNAPSHOT_VERSION_MAX } from '@/lib/sync/validateSnapshot';
import { setTokens } from '@/lib/google/tokenStore';
import { TOMBSTONE_TTL_DAYS } from '@/lib/sync/retention';
import { buildSnapshot } from '@/lib/sync/snapshot';

import { SyncManager } from './SyncManager';
import { SYNC_UPDATE_REQUIRED } from './syncErrorMessage';

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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
        response: jsonResponse(200, { id: 'file-new', name: 'data.json', version: '1' }),
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
      isSignedIn: async () => true,
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

  it('spec 004 FR-004: prunes local tombstones on the merge window, not 30 days', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    await db.tombstones.bulkPut([
      { entityId: 'mid', entityType: 'entry', deletedAt: daysAgo(60) },
      { entityId: 'stale', entityType: 'entry', deletedAt: daysAgo(TOMBSTONE_TTL_DAYS + 1) },
    ]);
    const { fetchImpl } = makeFetch([
      {
        match: (url) => url.includes('drive/v3/files') && !url.includes('upload'),
        response: jsonResponse(200, { files: [] }),
      },
      {
        match: (url) => url.includes('upload/drive/v3/files'),
        response: jsonResponse(200, { id: 'file-new', name: 'data.json', version: '1' }),
      },
    ]);
    const mgr = new SyncManager({
      database: db,
      fetchImpl,
      getAccessToken: async () => 'token-abc',
      isSignedIn: async () => true,
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });

    await mgr.enqueue({ op: 'pushDataJson', mutation: 'delete', entityType: 'entry' });
    await mgr.flushNow();

    // A 60-day-old deletion must survive: a device offline that long still
    // needs it, or the deleted row comes back on its next merge.
    expect(await db.tombstones.get('mid')).toBeDefined();
    expect(await db.tombstones.get('stale')).toBeUndefined();
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
      isSignedIn: async () => true,
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

  // Regression: a failed flush rescheduled the row with a backoff but armed
  // no timer, so nothing retried until the user's next edit or an `online`
  // event. The push could sit unsent for the rest of the session.
  it('retries by itself after a failed push, with no further user activity', async () => {
    await createCard(db, newCard());
    let uploadAttempts = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('upload/drive/v3/files')) {
        uploadAttempts += 1;
        if (uploadAttempts === 1) return new Response('boom', { status: 500 });
        return jsonResponse(200, { id: 'file-new' });
      }
      return jsonResponse(200, { files: [] });
    }) as unknown as typeof fetch;

    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      fetchImpl,
      getAccessToken: async () => 'tk',
      isSignedIn: async () => true,
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
      // Real timers on a 20ms schedule — fake timers deadlock with
      // fake-indexeddb (S28 journal).
      computeRetryDelay: () => 20,
    });

    await mgr.enqueue({ op: 'pushDataJson', mutation: 'create' });
    await mgr.flushNow();
    expect(mgr.getStatus()).toBe('error');
    expect(uploadAttempts).toBe(1);

    await vi.waitFor(
      async () => {
        expect(uploadAttempts).toBe(2);
        expect(await getAllSyncQueueRows(db)).toHaveLength(0);
        expect(mgr.getStatus()).toBe('idle');
      },
      { timeout: 3000 },
    );

    mgr.dispose();
  });

  it('bails out cleanly when the drive.appdata scope is not granted', async () => {
    await createCard(db, newCard());
    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      // No fetchImpl needed — we should never reach a Drive call.
      getAccessToken: async () => 'tk',
      isSignedIn: async () => true,
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
        response: jsonResponse(200, { id: 'file-new', name: 'data.json', version: '1' }),
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
      isSignedIn: async () => true,
      getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      attachWindowListeners: false,
    });
    await mgr.enqueue({ op: 'pushDataJson' });
    // Fire two concurrent flush calls — should share the in-flight promise
    // and result in a single Drive write.
    await Promise.all([mgr.flush(), mgr.flush()]);
    // S31 Task 14: assert EXACTLY one write, not `<= 1`. `<= 1` also passes if
    // BOTH flushes were silently dropped (a real regression); `toBe(1)` proves
    // the coalesced push actually happened.
    expect(createCallCount).toBe(1);
    mgr.dispose();
  });

  it('subscribes propagate status transitions', async () => {
    // Signed in at enqueue time, but no access token by the time flush runs
    // (renewal failed) — flush surfaces "No access token" as an `error`.
    let token: string | null = 'tk';
    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      getAccessToken: async () => token,
      isSignedIn: async () => true,
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

  it('spec 016 FR-008: a newer-format remote blocks the push but calendar ops still run', async () => {
    await db.settings.update('current', { hourtrackCalendarId: 'cal-1' });
    const newer = { schemaVersion: SUPPORTED_SNAPSHOT_VERSION_MAX + 1, cards: [] };
    const { fetchImpl, calls } = makeFetch([
      {
        match: (url) => url.includes('drive/v3/files?') && !url.includes('alt=media'),
        response: jsonResponse(200, { files: [{ id: 'f1', name: 'data.json', version: '7' }] }),
      },
      {
        match: (url) => url.includes('alt=media'),
        response: jsonResponse(200, newer),
      },
      {
        match: (url, init) => url.includes('calendar/v3') && init?.method === 'DELETE',
        response: new Response(null, { status: 204 }),
      },
    ]);
    const retryDelay = vi.fn(() => 0);
    const mgr = new SyncManager({
      database: db,
      debounceMs: 60_000,
      fetchImpl,
      getAccessToken: async () => 'tok',
      isSignedIn: async () => true,
      getGrantedScopes: async () => `${SCOPE_DRIVE_APPDATA} ${SCOPE_CALENDAR_APP_CREATED}`,
      attachWindowListeners: false,
      computeRetryDelay: retryDelay,
    });
    await db.syncQueue.add({
      op: 'deleteCalendarEvent',
      payload: { googleEventId: 'ev-1' },
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: new Date().toISOString(),
    });
    await db.syncQueue.add({
      op: 'pushDataJson',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: new Date().toISOString(),
    });

    await mgr.flushNow();

    expect(calls.filter((c) => c.startsWith('DELETE') && c.includes('calendar/v3'))).toHaveLength(
      1,
    );
    expect(calls.filter((c) => !c.startsWith('GET') && c.includes('drive'))).toHaveLength(0);
    const rows = await getAllSyncQueueRows(db);
    expect(rows.map((r) => r.op)).toEqual(['pushDataJson']);
    // Left as it was: not rescheduled, no error stamped, no retry backoff.
    expect(rows[0]?.attempts ?? 0).toBe(0);
    expect(retryDelay).not.toHaveBeenCalled();
    expect(mgr.getStatus()).toBe('error');
    expect(mgr.getLastError()).toBe(SYNC_UPDATE_REQUIRED);
    mgr.dispose();
  });

  it('S13: anonymous-user enqueue gate drops the op silently', async () => {
    const mgr = new SyncManager({
      database: db,
      debounceMs: 0,
      isSignedIn: async () => false,
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

// Spec 016 FR-009: queuing a change must not wait for a sign-in renewal — a
// tab closed during a pop-up renewal used to lose the op.
describe('SyncManager.enqueue — durable (FR-009)', () => {
  /** A renewal that never finishes — the tab is closed before it does. */
  const hangingToken = () => vi.fn(() => new Promise<string | null>(() => {}));

  it('writes the row without asking for an access token', async () => {
    const getAccessToken = hangingToken();
    const mgr = new SyncManager({
      database: db,
      debounceMs: 60_000,
      isSignedIn: async () => true,
      getAccessToken,
      attachWindowListeners: false,
    });
    await mgr.enqueue({ op: 'pushDataJson', mutation: 'create', entityType: 'card' });
    expect(await db.syncQueue.count()).toBe(1);
    expect(getAccessToken).not.toHaveBeenCalled();
    mgr.dispose();
  });

  it('by default treats a stored sign-in as signed in — no renewal, no network', async () => {
    await setTokens(
      { accessToken: 'expired', accessTokenExpiresAt: 0, scope: SCOPE_DRIVE_APPDATA },
      db,
    );
    const getAccessToken = hangingToken();
    const mgr = new SyncManager({
      database: db,
      debounceMs: 60_000,
      getAccessToken,
      attachWindowListeners: false,
    });
    await mgr.enqueue({ op: 'pushDataJson' });
    expect(await db.syncQueue.count()).toBe(1);
    expect(getAccessToken).not.toHaveBeenCalled();
    mgr.dispose();
  });

  it('by default writes nothing when no sign-in is stored', async () => {
    const mgr = new SyncManager({
      database: db,
      debounceMs: 60_000,
      getAccessToken: async () => 'unused',
      attachWindowListeners: false,
    });
    await mgr.enqueue({ op: 'pushDataJson' });
    expect(await db.syncQueue.count()).toBe(0);
    mgr.dispose();
  });
});

describe('SyncManager.pullNow — failures are visible (spec 016 review A6/A7)', () => {
  /** Drive with an existing `data.json` (v5, empty) that can be switched to 500s. */
  async function switchableDrive() {
    const state = { failing: true, uploads: 0 };
    // A valid shared copy: this device's own (empty) data.
    const empty = await buildSnapshot(db);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (state.failing) return new Response('backend error', { status: 503 });
      const url = new URL(input.toString());
      const method = init?.method ?? 'GET';
      if (url.pathname === '/drive/v3/files') {
        return jsonResponse(200, { files: [{ id: 'f1', name: 'data.json', version: '5' }] });
      }
      if (url.pathname === '/drive/v3/files/f1') {
        if (url.searchParams.get('alt') === 'media') return jsonResponse(200, empty);
        return jsonResponse(200, { id: 'f1', name: 'data.json', version: '5' });
      }
      if (url.pathname === '/upload/drive/v3/files/f1' && method === 'PATCH') {
        state.uploads += 1;
        return jsonResponse(200, { id: 'f1', name: 'data.json', version: '6' });
      }
      throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
    }) as typeof fetch;
    return { state, fetchImpl };
  }

  function manager(fetchImpl?: typeof fetch, scopes: string = SCOPE_DRIVE_APPDATA) {
    return new SyncManager({
      database: db,
      debounceMs: 60_000,
      fetchImpl,
      getAccessToken: async () => 'tk',
      isSignedIn: async () => true,
      getGrantedScopes: async () => scopes,
      attachWindowListeners: false,
    });
  }

  it('a failed pull reads error until a pull succeeds; an empty flush cannot repaint it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const drive = await switchableDrive();
    const mgr = manager(drive.fetchImpl);

    const failed = await mgr.pullNow();
    expect(failed.outcome).toBe('failed');
    expect(failed.unexpected).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(mgr.getStatus()).toBe('error');
    expect(mgr.getLastError()).toMatch(/503/);

    // The indicator click: nothing queued → the pull error stays.
    await mgr.flushNow();
    expect(mgr.getStatus()).toBe('error');
    expect(mgr.getLastError()).toMatch(/503/);

    drive.state.failing = false;
    expect((await mgr.pullNow()).outcome).toBe('pulled');
    expect(mgr.getStatus()).toBe('idle');
    expect(mgr.getLastError()).toBeUndefined();
    mgr.dispose();
  });

  it('a successful push clears the pull error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const drive = await switchableDrive();
    const mgr = manager(drive.fetchImpl);
    await mgr.pullNow();
    expect(mgr.getStatus()).toBe('error');

    drive.state.failing = false;
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();
    expect(drive.state.uploads).toBe(1);
    expect(mgr.getStatus()).toBe('idle');
    mgr.dispose();
  });

  it('a network failure (no HTTP answer) is an expected failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mgr = manager((async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    const result = await mgr.pullNow();
    expect(result.outcome).toBe('failed');
    expect(result.unexpected).toBeUndefined();
    mgr.dispose();
  });

  it('a local-database failure is unexpected: logged as an error, marked on the result', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const drive = await switchableDrive();
    drive.state.failing = false;
    const mgr = manager(drive.fetchImpl);
    db.close();

    const result = await mgr.pullNow();
    expect(result.outcome).toBe('failed');
    expect(result.unexpected).toBe(true);
    expect(error).toHaveBeenCalledWith(
      '[SyncManager] pull failed unexpectedly:',
      expect.anything(),
    );
    expect(mgr.getStatus()).toBe('error');
    mgr.dispose();
  });

  it('no-scope is not an error state', async () => {
    const mgr = manager(undefined, 'openid email');
    expect((await mgr.pullNow()).outcome).toBe('no-scope');
    expect(mgr.getStatus()).toBe('idle');
    mgr.dispose();
  });

  it('a forced pull downloads even when the remembered version matches', async () => {
    const drive = await switchableDrive();
    drive.state.failing = false;
    const mgr = manager(drive.fetchImpl);
    expect((await mgr.pullNow()).outcome).toBe('pulled');
    expect((await mgr.pullNow()).outcome).toBe('unchanged');
    expect((await mgr.pullNow({ force: true })).outcome).toBe('pulled');
    mgr.dispose();
  });

  it('a forced pull does not settle for a plain pull already in flight', async () => {
    const drive = await switchableDrive();
    drive.state.failing = false;
    const mgr = manager(drive.fetchImpl);
    await mgr.pullNow();
    const plain = mgr.pullNow();
    const forced = mgr.pullNow({ force: true });
    expect((await plain).outcome).toBe('unchanged');
    expect((await forced).outcome).toBe('pulled');
    mgr.dispose();
  });
});

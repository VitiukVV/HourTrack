import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, DriveSnapshot, Settings } from '@/shared/types';

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

/**
 * The multi-device convergence path (S31 / UR-31-7), rebuilt by spec 016:
 * Drive exposes no ETag to a browser, so a push reads the file's `version`
 * first and, when it changed, pulls → LWW-merges → applies → uploads the
 * merge. These tests pin that orchestration against an etag-less stub:
 * the version remembered after the last write, no download on an unchanged
 * remote, conflict side effects, merge-apply preserving a locally-newer row,
 * no upload over a corrupt remote, and the file lookup rules (FR-005/007).
 */

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-conflict-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  _resetConflictLog();
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
    position: 0,
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface StubDrive {
  fetchImpl: typeof fetch;
  /** `alt=media` downloads. */
  mediaReads: number;
  /** Bodies of content uploads (PATCH on the upload endpoint), parsed. */
  uploads: DriveSnapshot[];
  /** Files created via the multipart POST. */
  creates: number;
}

/**
 * A Drive stub with no etag anywhere: `data.json` (id `file-1` unless
 * `remoteId` says otherwise) at `remoteVersion`, whose contents are `remote`.
 * Each write bumps the version. `cachedIdMissing` makes the cached id 404.
 */
function stubDrive(opts: {
  remote: unknown;
  remoteVersion: number;
  remoteId?: string;
  cachedIdMissing?: string;
}): StubDrive {
  let version = opts.remoteVersion;
  const remoteId = opts.remoteId ?? 'file-1';
  const stub: StubDrive = {
    mediaReads: 0,
    uploads: [],
    creates: 0,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = init?.method ?? 'GET';
      if (opts.cachedIdMissing && url.pathname.endsWith(`/files/${opts.cachedIdMissing}`)) {
        return new Response('gone', { status: 404 });
      }
      if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
        stub.creates += 1;
        return jsonResponse(200, { id: 'file-created', name: 'data.json', version: '1' });
      }
      if (url.pathname === `/upload/drive/v3/files/${remoteId}` && method === 'PATCH') {
        stub.uploads.push(JSON.parse(String(init?.body)) as DriveSnapshot);
        version += 1;
        return jsonResponse(200, { id: remoteId, name: 'data.json', version: String(version) });
      }
      if (url.pathname === '/drive/v3/files' && method === 'GET') {
        return jsonResponse(200, {
          files: [{ id: remoteId, name: 'data.json', version: String(version) }],
        });
      }
      if (url.pathname === `/drive/v3/files/${remoteId}`) {
        if (method === 'PATCH') {
          version += 1;
          return jsonResponse(200, { appProperties: {}, version: String(version) });
        }
        if (url.searchParams.get('alt') === 'media') {
          stub.mediaReads += 1;
          return jsonResponse(200, opts.remote);
        }
        return jsonResponse(200, { id: remoteId, name: 'data.json', version: String(version) });
      }
      throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
    }) as typeof fetch,
  };
  return stub;
}

function makeManager(fetchImpl: typeof fetch): SyncManager {
  return new SyncManager({
    database: db,
    debounceMs: 0,
    fetchImpl,
    getAccessToken: async () => 'tk',
    isSignedIn: async () => true,
    getGrantedScopes: async () => `openid email profile ${SCOPE_DRIVE_APPDATA}`,
    attachWindowListeners: false,
  });
}

describe('SyncManager — pull before push (spec 016, replaces the 412 path)', () => {
  it('a changed remote version → downloads, merges, uploads the merge, remembers the last version', async () => {
    await createCard(db, newCard()); // local c1 (older updatedAt)
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({ remote: remoteSnapshot([remoteCard()]), remoteVersion: 6 });

    const mgr = makeManager(drive.fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    expect(drive.mediaReads).toBe(1);
    expect(drive.uploads).toHaveLength(1);
    expect(drive.uploads[0]?.cards[0]?.name).toBe('Remote name');

    // Content upload → 7, appProperties patch → 8: the patch is the last write.
    const settings = await getSettings(db);
    expect(settings?.driveDataEtag).toBe('8');
    expect(settings?.driveDataFileId).toBe('file-1');
    expect(settings?.lastSyncAt).toBeTruthy();
    expect(mgr.getStatus()).toBe('idle');
    expect(await getAllSyncQueueRows(db)).toHaveLength(0);

    // The remote-newer row was recorded as a conflict and applied locally.
    expect(getConflictLog().some((c) => c.entityType === 'card' && c.entityId === 'c1')).toBe(true);
    expect((await db.cards.get('c1'))?.name).toBe('Remote name');

    mgr.dispose();
  });

  it('an unchanged remote version → no download, uploads the local snapshot (SC-003)', async () => {
    await createCard(db, newCard());
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({ remote: remoteSnapshot([remoteCard()]), remoteVersion: 5 });

    const mgr = makeManager(drive.fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    expect(drive.mediaReads).toBe(0);
    expect(drive.uploads).toHaveLength(1);
    expect(drive.uploads[0]?.cards[0]?.name).toBe('Local name');
    expect((await getSettings(db))?.driveDataEtag).toBe('7');
    expect(getConflictLog()).toHaveLength(0);

    mgr.dispose();
  });

  it('an unknown remembered revision (old empty value) counts as changed', async () => {
    await createCard(db, newCard());
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '' });
    const drive = stubDrive({ remote: remoteSnapshot([]), remoteVersion: 5 });

    const mgr = makeManager(drive.fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    expect(drive.mediaReads).toBe(1);
    expect(drive.uploads[0]?.cards.map((c) => c.id)).toEqual(['c1']);

    mgr.dispose();
  });

  it('merge-apply preserves a locally-newer row (local edit not clobbered by an older remote)', async () => {
    await createCard(db, newCard({ name: 'Local newest' }));
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({
      remote: remoteSnapshot([
        remoteCard({ name: 'Remote older', updatedAt: '2020-01-01T00:00:00.000Z' }),
      ]),
      remoteVersion: 6,
    });

    const mgr = makeManager(drive.fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    expect((await db.cards.get('c1'))?.name).toBe('Local newest');
    expect(drive.uploads[0]?.cards[0]?.name).toBe('Local newest');
    expect(mgr.getStatus()).toBe('idle');

    mgr.dispose();
  });

  it('a corrupt remote is never uploaded over: error, row rescheduled, no loop', async () => {
    await createCard(db, newCard());
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({ remote: { schemaVersion: 8, cards: null }, remoteVersion: 6 });

    const mgr = makeManager(drive.fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    expect(drive.mediaReads).toBe(1);
    expect(drive.uploads).toHaveLength(0);
    expect(mgr.getStatus()).toBe('error');
    const rows = await getAllSyncQueueRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts ?? 0).toBeGreaterThanOrEqual(1);

    mgr.dispose();
  });

  it('no cached file id + an existing remote → merges into it instead of replacing it (FR-005)', async () => {
    await createCard(db, newCard({ id: 'local-only', name: 'Mine' }));
    const drive = stubDrive({
      remote: remoteSnapshot([remoteCard({ id: 'remote-only' })]),
      remoteVersion: 3,
    });

    const mgr = makeManager(drive.fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    expect(drive.creates).toBe(0);
    expect(drive.mediaReads).toBe(1);
    expect(drive.uploads[0]?.cards.map((c) => c.id).sort()).toEqual(['local-only', 'remote-only']);
    expect((await getSettings(db))?.driveDataFileId).toBe('file-1');

    mgr.dispose();
  });

  it('a cached id that 404s → looks the file up again and merges into it (FR-007)', async () => {
    await createCard(db, newCard({ id: 'local-only' }));
    await updateSettings(db, { driveDataFileId: 'file-old', driveDataEtag: '9' });
    const drive = stubDrive({
      remote: remoteSnapshot([remoteCard({ id: 'remote-only' })]),
      remoteVersion: 2,
      remoteId: 'file-2',
      cachedIdMissing: 'file-old',
    });

    const mgr = makeManager(drive.fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    expect(drive.creates).toBe(0);
    expect(drive.uploads[0]?.cards.map((c) => c.id).sort()).toEqual(['local-only', 'remote-only']);
    expect((await getSettings(db))?.driveDataFileId).toBe('file-2');
    expect(mgr.getStatus()).toBe('idle');

    mgr.dispose();
  });

  it('a cached id that 404s with no file left → creates one', async () => {
    await createCard(db, newCard());
    await updateSettings(db, { driveDataFileId: 'file-old', driveDataEtag: '9' });
    const base = stubDrive({ remote: null, remoteVersion: 1, cachedIdMissing: 'file-old' });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname === '/drive/v3/files' && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse(200, { files: [] });
      }
      return base.fetchImpl(input, init);
    }) as typeof fetch;

    const mgr = makeManager(fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();

    expect(base.creates).toBe(1);
    const settings = await getSettings(db);
    expect(settings?.driveDataFileId).toBe('file-created');
    expect(settings?.driveDataEtag).toBe('1');

    mgr.dispose();
  });
});

describe('SyncManager.pullNow', () => {
  it('an unchanged remote → outcome unchanged, no download, no upload', async () => {
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({ remote: remoteSnapshot([]), remoteVersion: 5 });
    const mgr = makeManager(drive.fetchImpl);

    const result = await mgr.pullNow();

    expect(result).toEqual({ outcome: 'unchanged', conflictCount: 0, hasCalendarScope: false });
    expect(drive.mediaReads).toBe(0);
    expect(drive.uploads).toHaveLength(0);
    mgr.dispose();
  });

  it('a changed remote with nothing new locally → pulled, applied, nothing uploaded', async () => {
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({ remote: remoteSnapshot([remoteCard()]), remoteVersion: 6 });
    const mgr = makeManager(drive.fetchImpl);

    const result = await mgr.pullNow();

    expect(result.outcome).toBe('pulled');
    expect(drive.uploads).toHaveLength(0);
    expect((await db.cards.get('c1'))?.name).toBe('Remote name');
    expect((await getSettings(db))?.driveDataEtag).toBe('6');
    mgr.dispose();
  });

  it('a changed remote lacking a local row → pulled and uploaded in the same cycle', async () => {
    await createCard(db, newCard({ id: 'local-only' }));
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({ remote: remoteSnapshot([remoteCard()]), remoteVersion: 6 });
    const mgr = makeManager(drive.fetchImpl);

    const result = await mgr.pullNow();

    expect(result.outcome).toBe('pulled');
    expect(result.conflictCount).toBe(0);
    expect(drive.uploads).toHaveLength(1);
    expect(drive.uploads[0]?.cards.map((c) => c.id).sort()).toEqual(['c1', 'local-only']);
    expect((await getSettings(db))?.driveDataEtag).toBe('8');
    mgr.dispose();
  });

  it('reports no-scope / no-token / offline without touching Drive', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const noScope = new SyncManager({
      database: db,
      fetchImpl,
      getAccessToken: async () => 'tk',
      isSignedIn: async () => true,
      getGrantedScopes: async () => 'openid',
      attachWindowListeners: false,
    });
    expect((await noScope.pullNow()).outcome).toBe('no-scope');

    const noToken = new SyncManager({
      database: db,
      fetchImpl,
      getAccessToken: async () => null,
      getGrantedScopes: async () => SCOPE_DRIVE_APPDATA,
      attachWindowListeners: false,
    });
    expect((await noToken.pullNow()).outcome).toBe('no-token');

    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect((await makeManager(fetchImpl).pullNow()).outcome).toBe('offline');
    onLine.mockRestore();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a Drive failure → outcome failed with the message, never throws', async () => {
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const fetchImpl = (async () => new Response('boom', { status: 503 })) as typeof fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await makeManager(fetchImpl).pullNow();

    expect(result.outcome).toBe('failed');
    expect(result.error).toMatch(/503/);
  });

  it('never overlaps a flush: the pull waits for the in-flight push (FR-011)', async () => {
    await createCard(db, newCard());
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({ remote: remoteSnapshot([]), remoteVersion: 5 });
    let active = 0;
    let maxActive = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await drive.fetchImpl(input, init);
      } finally {
        active -= 1;
      }
    }) as typeof fetch;
    const mgr = makeManager(fetchImpl);
    await mgr.enqueue({ op: 'pushDataJson' });

    const order: string[] = [];
    const flushing = mgr.flushNow().then(() => order.push('flush'));
    const pulling = mgr.pullNow().then(() => order.push('pull'));
    await Promise.all([flushing, pulling]);

    expect(order).toEqual(['flush', 'pull']);
    expect(maxActive).toBe(1);
    mgr.dispose();
  });

  it('concurrent pullNow calls share one run', async () => {
    await updateSettings(db, { driveDataFileId: 'file-1', driveDataEtag: '5' });
    const drive = stubDrive({ remote: remoteSnapshot([]), remoteVersion: 5 });
    const spy = vi.fn(drive.fetchImpl);
    const mgr = makeManager(spy as unknown as typeof fetch);

    const [a, b] = await Promise.all([mgr.pullNow(), mgr.pullNow()]);

    expect(a).toBe(b);
    expect(spy).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });
});

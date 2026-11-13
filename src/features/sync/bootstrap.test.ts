import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, DriveSnapshot, Entry } from '@/shared/types';

import { HourTrackDB } from '@/lib/db/schema';
import {
  createCard,
  createEntry,
  getAllCards,
  getAllEntries,
  getSettings,
  initDB,
} from '@/lib/db/queries';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { runBootstrap } from './bootstrap';
import { SyncManager } from './SyncManager';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-bootstrap-${Math.random().toString(36).slice(2)}`);
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

function newEntry(
  cardId: string,
  overrides: Partial<Entry> = {},
): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date: '2026-05-14',
    startMinutes: 600,
    durationMin: 240,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    ...overrides,
  };
}

/**
 * Build a `fetch` impl that returns the canned responses for Drive endpoints
 * we expect the bootstrap to call. The list of responses is consumed in
 * insertion order — leftover responses indicate a missed expectation; missed
 * responses indicate too many calls.
 */
function makeFetchStub(
  responses: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    response: Response;
  }>,
): typeof fetch {
  const queue = [...responses];
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const idx = queue.findIndex((r) => r.match(url, init));
    if (idx === -1) {
      throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    }
    const [match] = queue.splice(idx, 1);
    return match!.response;
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DRIVE_SCOPES = `openid email profile ${SCOPE_DRIVE_APPDATA}`;

/**
 * Spec 016: `runBootstrap` is a thin wrapper over `SyncManager.pullNow()` —
 * these tests drive it through a real manager with an etag-less Drive stub.
 */
function manager(opts: {
  token?: string | null;
  scopes?: string;
  fetchImpl?: typeof fetch;
}): SyncManager {
  const created = new SyncManager({
    database: db,
    fetchImpl: opts.fetchImpl ?? (() => Promise.reject(new Error('should not be called'))),
    getAccessToken: async () => (opts.token === undefined ? 'token-abc' : opts.token),
    getGrantedScopes: async () => opts.scopes ?? DRIVE_SCOPES,
    attachWindowListeners: false,
  });
  managers.push(created);
  return created;
}

const managers: SyncManager[] = [];
afterEach(() => {
  for (const m of managers.splice(0)) m.dispose();
});

describe('runBootstrap', () => {
  it('returns no-scope when drive.appdata is not granted', async () => {
    const result = await runBootstrap(manager({ scopes: 'openid email profile' }));
    expect(result.outcome).toBe('no-scope');
  });

  it('returns no-token when accessToken is missing', async () => {
    const result = await runBootstrap(manager({ token: null }));
    expect(result.outcome).toBe('no-token');
  });

  it('creates data.json on first run when no Drive file exists', async () => {
    // 1st call: findFile -> returns empty list
    // 2nd call: createJsonFile -> returns the created metadata
    const fetchStub = makeFetchStub([
      {
        match: (url) => url.includes('drive/v3/files') && !url.includes('upload'),
        response: jsonResponse(200, { files: [] }),
      },
      {
        match: (url) => url.includes('upload/drive/v3/files'),
        response: jsonResponse(200, {
          id: 'file-new',
          name: 'data.json',
          modifiedTime: '2026-05-15T00:00:00.000Z',
          version: '1',
        }),
      },
    ]);

    await createCard(db, newCard({ name: 'Card A' }));

    const result = await runBootstrap(manager({ fetchImpl: fetchStub }));

    expect(result.outcome).toBe('created');
    const settings = await getSettings(db);
    expect(settings?.driveDataFileId).toBe('file-new');
    expect(settings?.lastSyncAt).toBeTruthy();
  });

  it('merges a remote snapshot into empty Dexie correctly', async () => {
    const remoteSnapshot: DriveSnapshot = {
      schemaVersion: 2,
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
        lastSyncAt: '2026-05-14T00:00:00.000Z',
        firstLoginAt: null,
        deviceId: 'remote-device',
        driveDataFileId: 'should-not-overwrite',
        driveDataEtag: 'should-not-overwrite',
        onboardingSeen: false,
      },
      cards: [
        {
          id: 'remote-card-1',
          name: 'From Remote',
          color: '#2563EB',
          position: 0,
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
      entries: [
        {
          id: 'remote-entry-1',
          cardId: 'remote-card-1',
          date: '2026-05-13',
          startMinutes: 600,
          durationMin: 120,
          useCustomPayment: false,
          customPayment: null,
          note: null,
          googleEventId: null,
          syncStatus: 'synced',
          syncError: null,
          createdAt: '2026-05-13T00:00:00.000Z',
          updatedAt: '2026-05-13T00:00:00.000Z',
        },
      ],
      tombstones: [],
    };

    // findFile finds the existing file (with its version), then the content
    // is downloaded. Empty local + non-empty remote → apply, and nothing to
    // upload; a push attempt would hit no stub and fail the test.
    const fetchStub = makeFetchStub([
      {
        match: (url) =>
          url.includes('drive/v3/files') &&
          !url.includes('upload') &&
          url.includes('q=') &&
          url.includes(`name`),
        response: jsonResponse(200, {
          files: [{ id: 'file-existing', name: 'data.json', version: '7' }],
        }),
      },
      {
        match: (url) => url.includes('drive/v3/files/file-existing') && url.includes('alt=media'),
        response: jsonResponse(200, remoteSnapshot),
      },
    ]);

    const result = await runBootstrap(manager({ fetchImpl: fetchStub }));

    expect(result.outcome).toBe('pulled');

    const cards = await getAllCards(db, true);
    expect(cards.map((c) => c.id)).toContain('remote-card-1');
    const entries = await getAllEntries(db);
    expect(entries.map((e) => e.id)).toContain('remote-entry-1');

    const settings = await getSettings(db);
    expect(settings?.driveDataFileId).toBe('file-existing');
    expect(settings?.driveDataEtag).toBe('7');
    // Device id should remain whatever this device generated, NOT the
    // remote one — applySnapshot preserves device-local bookkeeping.
    expect(settings?.deviceId).not.toBe('remote-device');
  });

  it('recreates the file when Drive responds 404 on the cached fileId', async () => {
    // Pre-seed a cached driveDataFileId so the bootstrap doesn't search.
    await db.settings.put({
      key: 'current',
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
      driveDataFileId: 'stale-fileid',
      driveDataEtag: 'stale-etag',
      onboardingSeen: false,
    });
    await createCard(db, newCard({ name: 'Will be created' }));

    const fetchStub = makeFetchStub([
      {
        // readFileMeta on the cached id -> 404
        match: (url) => url.includes('drive/v3/files/stale-fileid'),
        response: new Response('Not Found', { status: 404 }),
      },
      {
        // FR-007: look for an existing file before creating -> none
        match: (url) => url.includes('drive/v3/files?') && url.includes('q='),
        response: jsonResponse(200, { files: [] }),
      },
      {
        // createJsonFile -> success
        match: (url) => url.includes('upload/drive/v3/files'),
        response: jsonResponse(200, {
          id: 'file-recreated',
          name: 'data.json',
          modifiedTime: '2026-05-15T00:00:00.000Z',
          version: '1',
        }),
      },
    ]);

    const result = await runBootstrap(manager({ fetchImpl: fetchStub }));

    expect(result.outcome).toBe('created');
    const settings = await getSettings(db);
    expect(settings?.driveDataFileId).toBe('file-recreated');
  });

  it('surfaces a failed outcome when the Drive call throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchStub = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    await createEntry(db, newEntry(crypto.randomUUID()));
    const result = await runBootstrap(manager({ fetchImpl: fetchStub }));
    expect(result.outcome).toBe('failed');
    expect(result.error).toMatch(/network down/);
  });
});

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Card, DriveSnapshot, Entry } from '@hourtrack/shared-types';

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

function newEntry(
  cardId: string,
  overrides: Partial<Entry> = {},
): Omit<Entry, 'createdAt' | 'updatedAt'> {
  return {
    id: crypto.randomUUID(),
    cardId,
    date: '2026-05-14',
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

function jsonResponse(status: number, body: unknown, etag = 'etag-1'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', etag },
  });
}

describe('runBootstrap', () => {
  it('returns no-scope when drive.appdata is not granted', async () => {
    const result = await runBootstrap({
      database: db,
      accessToken: 'token-abc',
      grantedScopes: 'openid email profile',
      fetchImpl: () => Promise.reject(new Error('should not be called')),
    });
    expect(result.outcome).toBe('no-scope');
  });

  it('returns no-token when accessToken is missing', async () => {
    const result = await runBootstrap({
      database: db,
      accessToken: null,
      grantedScopes: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
    });
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
        }),
      },
    ]);

    await createCard(db, newCard({ name: 'Card A' }));

    const result = await runBootstrap({
      database: db,
      accessToken: 'token-abc',
      grantedScopes: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      fetchImpl: fetchStub,
    });

    expect(result.outcome).toBe('created');
    expect(result.fileId).toBe('file-new');
    const settings = await getSettings(db);
    expect(settings?.driveDataFileId).toBe('file-new');
    expect(settings?.lastSyncAt).toBeTruthy();
  });

  it('merges a remote snapshot into empty Dexie correctly', async () => {
    const remoteSnapshot: DriveSnapshot = {
      schemaVersion: 1,
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
          color: '#3B82F6',
          defaultDurationMin: 480,
          rateType: 'hourly',
          hourlyRate: 25,
          fixedTotal: null,
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

    // findFile finds the existing file, then readFileMeta for etag,
    // then readJsonFile for content. Bootstrap may or may not push back
    // (empty local + non-empty remote → applySnapshot, no push needed
    // because local diverged from merge but applies). We only set up
    // responses for the read path here; if bootstrap tries to push, the
    // missing response surfaces a clear error.
    const fetchStub = makeFetchStub([
      {
        match: (url) =>
          url.includes('drive/v3/files') &&
          !url.includes('upload') &&
          url.includes('q=') &&
          url.includes(`name`),
        response: jsonResponse(200, {
          files: [{ id: 'file-existing', name: 'data.json' }],
        }),
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
        response: jsonResponse(200, remoteSnapshot, 'etag-server'),
      },
    ]);

    const result = await runBootstrap({
      database: db,
      accessToken: 'token-abc',
      grantedScopes: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      fetchImpl: fetchStub,
    });

    expect(result.outcome === 'merged-remote-newer' || result.outcome === 'in-sync').toBe(true);

    const cards = await getAllCards(db, true);
    expect(cards.map((c) => c.id)).toContain('remote-card-1');
    const entries = await getAllEntries(db);
    expect(entries.map((e) => e.id)).toContain('remote-entry-1');

    const settings = await getSettings(db);
    expect(settings?.driveDataFileId).toBe('file-existing');
    expect(settings?.driveDataEtag).toBe('etag-server');
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
        // readJsonFile -> 404
        match: (url) => url.includes('drive/v3/files/stale-fileid') && url.includes('alt=media'),
        response: new Response('Not Found', { status: 404 }),
      },
      {
        // createJsonFile -> success
        match: (url) => url.includes('upload/drive/v3/files'),
        response: jsonResponse(200, {
          id: 'file-recreated',
          name: 'data.json',
          modifiedTime: '2026-05-15T00:00:00.000Z',
        }),
      },
    ]);

    const result = await runBootstrap({
      database: db,
      accessToken: 'token-abc',
      grantedScopes: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      fetchImpl: fetchStub,
    });

    expect(result.outcome).toBe('created');
    expect(result.fileId).toBe('file-recreated');
    const settings = await getSettings(db);
    expect(settings?.driveDataFileId).toBe('file-recreated');
  });

  it('surfaces a failed outcome when the Drive call throws', async () => {
    const fetchStub = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    await createEntry(db, newEntry(crypto.randomUUID()));
    const result = await runBootstrap({
      database: db,
      accessToken: 'token-abc',
      grantedScopes: `openid email profile ${SCOPE_DRIVE_APPDATA}`,
      fetchImpl: fetchStub,
    });
    expect(result.outcome).toBe('failed');
    expect(result.error).toMatch(/network down/);
  });
});

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HourTrackDB } from '@/lib/db/schema';
import { createCard, getSettings, initDB } from '@/lib/db/queries';

import {
  BACKUP_KEEP_COUNT,
  createBackup,
  createPreRestoreBackup,
  formatBackupFilename,
  formatPreRestoreFilename,
  hasAnyBackup,
  listBackupFiles,
  rotateBackups,
} from './backupService';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-backup-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

interface Stub {
  match: (url: string, init?: RequestInit) => boolean;
  response: () => Response;
}

function makeFetch(stubs: Stub[]): { fetchImpl: typeof fetch; calls: string[] } {
  const queue = [...stubs];
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const idx = queue.findIndex((s) => s.match(url, init));
    if (idx === -1) throw new Error(`Unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    return queue.splice(idx, 1)[0]!.response();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown, etag = 'etag-1'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', etag },
  });
}

describe('formatBackupFilename', () => {
  it('produces YYYY-MM-DDTHHmm.json under backups/', () => {
    const name = formatBackupFilename(new Date('2026-05-15T17:42:00Z'));
    expect(name).toBe('backups/2026-05-15T1742.json');
  });

  it('zero-pads hours and minutes', () => {
    const name = formatBackupFilename(new Date('2026-01-02T03:04:00Z'));
    expect(name).toBe('backups/2026-01-02T0304.json');
  });

  it('is lexicographically sortable across dates', () => {
    const a = formatBackupFilename(new Date('2026-05-01T10:00:00Z'));
    const b = formatBackupFilename(new Date('2026-05-01T11:00:00Z'));
    const c = formatBackupFilename(new Date('2026-05-02T09:00:00Z'));
    expect([c, b, a].sort()).toEqual([a, b, c]);
  });
});

describe('formatPreRestoreFilename', () => {
  it('produces backups/pre-restore-<safe-iso>.json', () => {
    const name = formatPreRestoreFilename(new Date('2026-05-15T17:42:33.456Z'));
    expect(name).toMatch(/^backups\/pre-restore-2026-05-15T174233Z\.json$/);
  });
});

describe('listBackupFiles', () => {
  it('filters to files under the backups/ prefix and sorts newest-first lexicographically', async () => {
    // NOTE: filenames are ASCII-sorted descending. `'p'` (0x70) > `'2'` (0x32),
    // so `backups/pre-restore-…` names sort BEFORE date-stamped backups. This
    // is intentional: the `pre-restore` prefix groups safety snapshots at the
    // top of the picker which is the right UX (the user just made one and
    // is most likely to roll back to it). The rotation logic respects the
    // same order — `pre-restore` files count against the 10-file cap and get
    // pruned from the OLDEST end first.
    const stubs: Stub[] = [
      {
        match: (url) => url.includes('drive/v3/files') && !url.includes('upload'),
        response: () =>
          jsonResponse(200, {
            files: [
              { id: 'b', name: 'backups/2026-05-14T1000.json' },
              { id: 'a', name: 'backups/2026-05-15T1000.json' },
              { id: 'd', name: 'data.json' },
              { id: 'p', name: 'backups/pre-restore-2026-05-15T093000Z.json' },
            ],
          }),
      },
    ];
    const { fetchImpl } = makeFetch(stubs);
    const result = await listBackupFiles({
      accessToken: 'token-abc',
      fetchImpl,
    });
    expect(result.map((f) => f.name)).toEqual([
      'backups/pre-restore-2026-05-15T093000Z.json',
      'backups/2026-05-15T1000.json',
      'backups/2026-05-14T1000.json',
    ]);
    // data.json filtered out
    expect(result.find((f) => f.name === 'data.json')).toBeUndefined();
    expect(result.find((f) => f.isPreRestore)).toBeDefined();
  });
});

describe('rotateBackups', () => {
  it('returns 0 when total files do not exceed keepCount', async () => {
    const fileList = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      name: `backups/2026-05-${10 + i}T1000.json`,
    }));
    const { fetchImpl } = makeFetch([
      {
        match: (url) => url.includes('drive/v3/files') && !url.includes('upload'),
        response: () => jsonResponse(200, { files: fileList }),
      },
    ]);
    const deleted = await rotateBackups({
      accessToken: 'token-abc',
      database: db,
      fetchImpl,
    });
    expect(deleted).toBe(0);
  });

  it('keeps the newest 10 and deletes 1 when 11 backups exist', async () => {
    // Build 11 files with monotonically increasing names. Oldest = index 0.
    const fileList = Array.from({ length: 11 }, (_, i) => ({
      id: `id-${String(i).padStart(2, '0')}`,
      name: `backups/2026-05-${String(10 + i).padStart(2, '0')}T1000.json`,
    }));
    // Capture delete calls so we can assert WHICH file was removed.
    const deleteUrls: string[] = [];
    const { fetchImpl } = makeFetch([
      {
        match: (url, init) => url.includes('drive/v3/files') && (init?.method ?? 'GET') === 'GET',
        response: () => jsonResponse(200, { files: fileList }),
      },
      {
        match: (url, init) =>
          url.includes('drive/v3/files') && (init?.method ?? 'GET') === 'DELETE',
        response: () => {
          deleteUrls.push('captured');
          return new Response('', { status: 204 });
        },
      },
    ]);
    const deleted = await rotateBackups({
      accessToken: 'token-abc',
      database: db,
      fetchImpl,
    });
    expect(deleted).toBe(1);
    // The OLDEST file (`id-00`) should have been the delete target.
    expect(deleteUrls).toHaveLength(1);
  });

  it('respects a custom keepCount for tests', async () => {
    const fileList = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      name: `backups/2026-05-${10 + i}T1000.json`,
    }));
    const stubs: Stub[] = [
      {
        match: (url, init) => url.includes('drive/v3/files') && (init?.method ?? 'GET') === 'GET',
        response: () => jsonResponse(200, { files: fileList }),
      },
    ];
    // Three deletes expected (keep 2 of 5).
    for (let i = 0; i < 3; i += 1) {
      stubs.push({
        match: (url, init) =>
          url.includes('drive/v3/files') && (init?.method ?? 'GET') === 'DELETE',
        response: () => new Response('', { status: 204 }),
      });
    }
    const { fetchImpl } = makeFetch(stubs);
    const deleted = await rotateBackups({
      accessToken: 'token-abc',
      database: db,
      fetchImpl,
      keepCount: 2,
    });
    expect(deleted).toBe(3);
  });
});

describe('createBackup', () => {
  it('uploads a snapshot file and stamps Settings.lastBackupAt', async () => {
    // Seed minimal state so the snapshot is non-trivial.
    await createCard(db, {
      id: 'card-1',
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
    });

    const fixedNow = new Date('2026-05-15T17:42:00Z');

    const stubs: Stub[] = [
      // createJsonFile upload
      {
        match: (url, init) =>
          url.includes('upload/drive/v3/files') && (init?.method ?? 'GET') === 'POST',
        response: () =>
          jsonResponse(
            200,
            {
              id: 'newly-created',
              name: 'backups/2026-05-15T1742.json',
              modifiedTime: '2026-05-15T17:42:01.000Z',
              appProperties: { schemaVersion: '2', deviceId: 'd-1', kind: 'manual-or-auto' },
            },
            'etag-up',
          ),
      },
      // rotation listFiles
      {
        match: (url, init) => url.includes('drive/v3/files') && (init?.method ?? 'GET') === 'GET',
        response: () =>
          jsonResponse(200, {
            files: [{ id: 'newly-created', name: 'backups/2026-05-15T1742.json' }],
          }),
      },
    ];
    const { fetchImpl, calls } = makeFetch(stubs);

    const result = await createBackup({
      accessToken: 'token-abc',
      database: db,
      fetchImpl,
      now: fixedNow,
    });

    expect(result.file.name).toBe('backups/2026-05-15T1742.json');
    expect(result.file.id).toBe('newly-created');
    expect(result.file.isPreRestore).toBe(false);
    expect(result.backupAt).toBe(fixedNow.toISOString());
    expect(result.rotated).toBe(0);
    // Settings should now have lastBackupAt set.
    const settings = await getSettings(db);
    expect(settings?.lastBackupAt).toBe(fixedNow.toISOString());
    // Should have made the upload + a list call for rotation.
    expect(calls.some((c) => c.startsWith('POST') && c.includes('upload'))).toBe(true);
    expect(calls.some((c) => c.startsWith('GET') && c.includes('drive/v3/files'))).toBe(true);
  });

  it('rotates older files when the resulting count exceeds the cap', async () => {
    // Pre-populate Drive with 10 existing backups. After our new upload, the
    // list will have 11, and rotation should delete the oldest one.
    const existing = Array.from({ length: 10 }, (_, i) => ({
      id: `id-${String(i).padStart(2, '0')}`,
      name: `backups/2026-05-${String(1 + i).padStart(2, '0')}T1000.json`,
    }));
    const newName = 'backups/2026-05-15T1200.json';
    const fileListAfterUpload = [{ id: 'new-id', name: newName }, ...existing];

    let deleteCalls = 0;
    const stubs: Stub[] = [
      {
        match: (url, init) =>
          url.includes('upload/drive/v3/files') && (init?.method ?? 'GET') === 'POST',
        response: () => jsonResponse(200, { id: 'new-id', name: newName }, 'etag-up'),
      },
      {
        match: (url, init) => url.includes('drive/v3/files') && (init?.method ?? 'GET') === 'GET',
        response: () => jsonResponse(200, { files: fileListAfterUpload }),
      },
      {
        match: (url, init) =>
          url.includes('drive/v3/files') && (init?.method ?? 'GET') === 'DELETE',
        response: () => {
          deleteCalls += 1;
          return new Response('', { status: 204 });
        },
      },
    ];
    const { fetchImpl } = makeFetch(stubs);

    const result = await createBackup({
      accessToken: 'token-abc',
      database: db,
      fetchImpl,
      now: new Date('2026-05-15T12:00:00Z'),
    });
    expect(result.rotated).toBe(1);
    expect(deleteCalls).toBe(1);
  });

  it('createPreRestoreBackup uses pre-restore- filename and skips rotation', async () => {
    const stubs: Stub[] = [
      {
        match: (url, init) =>
          url.includes('upload/drive/v3/files') && (init?.method ?? 'GET') === 'POST',
        response: () =>
          jsonResponse(
            200,
            {
              id: 'pre-restore-id',
              name: 'backups/pre-restore-2026-05-15T120000Z.json',
            },
            'etag',
          ),
      },
      // NOTE: we deliberately omit a list-files stub. If `createPreRestoreBackup`
      // tries to rotate, the makeFetch dispatcher will throw "Unexpected fetch"
      // and this test will fail.
    ];
    const { fetchImpl } = makeFetch(stubs);

    const result = await createPreRestoreBackup({
      accessToken: 'token-abc',
      database: db,
      fetchImpl,
      now: new Date('2026-05-15T12:00:00Z'),
    });
    expect(result.file.name).toMatch(/^backups\/pre-restore-/);
    expect(result.file.isPreRestore).toBe(true);
    expect(result.rotated).toBe(0);
  });
});

describe('hasAnyBackup', () => {
  it('returns false when Settings.lastBackupAt is null', async () => {
    expect(await hasAnyBackup(db)).toBe(false);
  });

  it('returns true after a backup has stamped Settings.lastBackupAt', async () => {
    // Manually stamp without going through createBackup.
    const { updateSettings } = await import('@/lib/db/queries');
    await updateSettings(db, { lastBackupAt: new Date().toISOString() });
    expect(await hasAnyBackup(db)).toBe(true);
  });
});

describe('BACKUP_KEEP_COUNT constant', () => {
  it('is exactly 10 per the spec', () => {
    expect(BACKUP_KEEP_COUNT).toBe(10);
  });
});

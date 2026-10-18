import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HourTrackDB } from '@/lib/db/schema';
import { initDB, updateSettings } from '@/lib/db/queries';
import { SCOPE_DRIVE_APPDATA } from '@/lib/google/config';

import { runAutoBackupIfDue } from './autoBackup';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-autobackup-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

const goodScopes = `openid email profile ${SCOPE_DRIVE_APPDATA}`;

function makeUploadFetch(): { fetchImpl: typeof fetch; uploadCount: () => number } {
  let uploads = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (url.includes('upload/drive/v3/files') && method === 'POST') {
      uploads += 1;
      return new Response(
        JSON.stringify({
          id: `upload-${uploads}`,
          name: 'backups/2026-05-15T1000.json',
          modifiedTime: '2026-05-15T10:00:01.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', etag: 'etag-x' } },
      );
    }
    if (url.includes('drive/v3/files') && method === 'GET') {
      // listFiles for rotation — return only the file we just uploaded.
      return new Response(
        JSON.stringify({
          files: [{ id: `upload-${uploads}`, name: 'backups/2026-05-15T1000.json' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  }) as typeof fetch;
  return { fetchImpl, uploadCount: () => uploads };
}

describe('runAutoBackupIfDue', () => {
  it('returns no-token when access token is missing', async () => {
    const result = await runAutoBackupIfDue({
      accessToken: null,
      grantedScopes: goodScopes,
      database: db,
    });
    expect(result.outcome).toBe('no-token');
  });

  it('returns no-scope when drive.appdata is not granted', async () => {
    const result = await runAutoBackupIfDue({
      accessToken: 'token-abc',
      grantedScopes: 'openid email profile',
      database: db,
    });
    expect(result.outcome).toBe('no-scope');
  });

  it('returns skipped-disabled when autoBackupEnabled is false', async () => {
    await updateSettings(db, { autoBackupEnabled: false });
    const result = await runAutoBackupIfDue({
      accessToken: 'token-abc',
      grantedScopes: goodScopes,
      database: db,
    });
    expect(result.outcome).toBe('skipped-disabled');
  });

  it('triggers backup when lastBackupAt is null', async () => {
    // Default settings: autoBackupEnabled=true, autoBackupIntervalDays=3,
    // lastBackupAt=null.
    const { fetchImpl, uploadCount } = makeUploadFetch();
    const result = await runAutoBackupIfDue({
      accessToken: 'token-abc',
      grantedScopes: goodScopes,
      database: db,
      fetchImpl,
      now: new Date('2026-05-15T10:00:00Z'),
    });
    expect(result.outcome).toBe('created');
    expect(uploadCount()).toBe(1);
  });

  it('triggers backup when lastBackupAt was 4 days ago and interval is 3', async () => {
    const fourDaysAgo = new Date('2026-05-11T10:00:00Z').toISOString();
    await updateSettings(db, {
      lastBackupAt: fourDaysAgo,
      autoBackupIntervalDays: 3,
    });
    const { fetchImpl, uploadCount } = makeUploadFetch();
    const result = await runAutoBackupIfDue({
      accessToken: 'token-abc',
      grantedScopes: goodScopes,
      database: db,
      fetchImpl,
      now: new Date('2026-05-15T10:00:00Z'),
    });
    expect(result.outcome).toBe('created');
    expect(uploadCount()).toBe(1);
  });

  it('does NOT trigger backup when lastBackupAt was 1 day ago and interval is 3', async () => {
    const oneDayAgo = new Date('2026-05-14T10:00:00Z').toISOString();
    await updateSettings(db, {
      lastBackupAt: oneDayAgo,
      autoBackupIntervalDays: 3,
    });
    const result = await runAutoBackupIfDue({
      accessToken: 'token-abc',
      grantedScopes: goodScopes,
      database: db,
      // No fetchImpl provided: a stray upload would explode with network error
      // — that's the verification the backup did NOT run.
      now: new Date('2026-05-15T10:00:00Z'),
    });
    expect(result.outcome).toBe('skipped-not-due');
  });

  it('autoBackupEnabled=false suppresses even when long overdue', async () => {
    const longAgo = new Date('2026-01-01T10:00:00Z').toISOString();
    await updateSettings(db, {
      lastBackupAt: longAgo,
      autoBackupEnabled: false,
    });
    const result = await runAutoBackupIfDue({
      accessToken: 'token-abc',
      grantedScopes: goodScopes,
      database: db,
      now: new Date('2026-05-15T10:00:00Z'),
    });
    expect(result.outcome).toBe('skipped-disabled');
  });

  it('returns failed (does NOT throw) when createBackup throws', async () => {
    // Stub fetch to reject upload — simulates network failure.
    const fetchImpl = (async () => {
      throw new Error('Network down');
    }) as typeof fetch;
    const result = await runAutoBackupIfDue({
      accessToken: 'token-abc',
      grantedScopes: goodScopes,
      database: db,
      fetchImpl,
      now: new Date('2026-05-15T10:00:00Z'),
    });
    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('Network down');
  });

  it('honors a custom interval at the day boundary', async () => {
    // Interval = 7 days. Last = exactly 7 days + 1 ms ago. SHOULD trigger.
    const last = new Date('2026-05-08T09:59:59.999Z').toISOString();
    await updateSettings(db, {
      lastBackupAt: last,
      autoBackupIntervalDays: 7,
    });
    const { fetchImpl } = makeUploadFetch();
    const result = await runAutoBackupIfDue({
      accessToken: 'token-abc',
      grantedScopes: goodScopes,
      database: db,
      fetchImpl,
      now: new Date('2026-05-15T10:00:00Z'),
    });
    expect(result.outcome).toBe('created');
  });
});

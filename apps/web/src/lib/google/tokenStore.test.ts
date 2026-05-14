import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HourTrackDB } from '@/lib/db/schema';

import {
  clearTokens,
  getTokens,
  setTokens,
  setUserProfile,
  subscribe,
  type AuthTokens,
} from './tokenStore';

/**
 * Each test uses a fresh DB instance via a unique name so that the Dexie
 * `authTokens` store starts empty and tests don't leak state into one
 * another. The module-level `listeners` Set inside tokenStore is shared
 * process-wide, so subscribers are explicitly unsubscribed in cleanup.
 */
let db: HourTrackDB;
let unsubs: Array<() => void> = [];

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-test-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(async () => {
  for (const u of unsubs) u();
  unsubs = [];
  await db.delete();
});

describe('tokenStore.getTokens', () => {
  it('returns null when no row exists', async () => {
    expect(await getTokens(db)).toBeNull();
  });
});

describe('tokenStore.setTokens', () => {
  it('creates the row on first write with all required fields', async () => {
    const next = await setTokens(
      {
        accessToken: 'AT-1',
        accessTokenExpiresAt: 1_700_000_000_000,
        scope: 'openid email profile',
      },
      db,
    );
    expect(next.accessToken).toBe('AT-1');
    expect(next.accessTokenExpiresAt).toBe(1_700_000_000_000);
    expect(next.scope).toBe('openid email profile');
    expect(next.refreshToken).toBeNull();
    expect(next.idToken).toBeNull();
    expect(next.email).toBeNull();
    expect(next.name).toBeNull();
    expect(next.picture).toBeNull();
  });

  it('persists to Dexie and is readable via getTokens', async () => {
    await setTokens(
      {
        accessToken: 'AT-2',
        accessTokenExpiresAt: 1_700_000_000_000,
        scope: 'openid email profile',
        refreshToken: 'RT-1',
      },
      db,
    );
    const read = await getTokens(db);
    expect(read?.accessToken).toBe('AT-2');
    expect(read?.refreshToken).toBe('RT-1');
  });

  it('merges patches with existing fields (partial update preserves the rest)', async () => {
    await setTokens(
      {
        accessToken: 'AT-old',
        accessTokenExpiresAt: 100,
        scope: 'openid email profile',
        refreshToken: 'RT-keep',
        idToken: 'ID-keep',
      },
      db,
    );
    await setTokens(
      {
        accessToken: 'AT-new',
        accessTokenExpiresAt: 200,
        scope: 'openid email profile',
      },
      db,
    );
    const after = await getTokens(db);
    expect(after?.accessToken).toBe('AT-new');
    expect(after?.accessTokenExpiresAt).toBe(200);
    expect(after?.refreshToken).toBe('RT-keep');
    expect(after?.idToken).toBe('ID-keep');
  });
});

describe('tokenStore.setUserProfile', () => {
  it('returns null when no tokens row exists yet', async () => {
    const result = await setUserProfile({ email: 'a@b.c', name: 'X', picture: 'http://x' }, db);
    expect(result).toBeNull();
  });

  it('updates email/name/picture without touching tokens', async () => {
    await setTokens(
      {
        accessToken: 'AT',
        accessTokenExpiresAt: 100,
        scope: 'openid email profile',
        refreshToken: 'RT',
      },
      db,
    );
    const updated = await setUserProfile(
      { email: 'user@example.com', name: 'User', picture: 'https://example.com/pic.png' },
      db,
    );
    expect(updated?.email).toBe('user@example.com');
    expect(updated?.name).toBe('User');
    expect(updated?.picture).toBe('https://example.com/pic.png');
    expect(updated?.accessToken).toBe('AT');
    expect(updated?.refreshToken).toBe('RT');
  });
});

describe('tokenStore.clearTokens', () => {
  it('wipes the row and subsequent getTokens returns null', async () => {
    await setTokens(
      {
        accessToken: 'AT',
        accessTokenExpiresAt: 100,
        scope: 'openid email profile',
      },
      db,
    );
    await clearTokens(db);
    expect(await getTokens(db)).toBeNull();
  });

  it('is idempotent when called with no row present', async () => {
    await expect(clearTokens(db)).resolves.toBeUndefined();
    expect(await getTokens(db)).toBeNull();
  });
});

describe('tokenStore.subscribe', () => {
  it('fires listener with initial snapshot (null when empty)', async () => {
    const spy = vi.fn();
    unsubs.push(subscribe(spy, db));
    // Wait a tick for the async initial snapshot to flush.
    await new Promise((r) => setTimeout(r, 5));
    expect(spy).toHaveBeenCalledWith(null);
  });

  it('fires listener after setTokens with the new snapshot', async () => {
    const spy = vi.fn();
    unsubs.push(subscribe(spy, db));
    await new Promise((r) => setTimeout(r, 5));
    spy.mockClear();
    const next: AuthTokens = await setTokens(
      {
        accessToken: 'AT-sub',
        accessTokenExpiresAt: 999,
        scope: 'openid email profile',
      },
      db,
    );
    expect(spy).toHaveBeenCalledWith(next);
  });

  it('fires listener with null after clearTokens', async () => {
    await setTokens(
      {
        accessToken: 'AT',
        accessTokenExpiresAt: 999,
        scope: 'openid email profile',
      },
      db,
    );
    const spy = vi.fn();
    unsubs.push(subscribe(spy, db));
    await new Promise((r) => setTimeout(r, 5));
    spy.mockClear();
    await clearTokens(db);
    expect(spy).toHaveBeenCalledWith(null);
  });

  it('unsubscribe stops further notifications', async () => {
    const spy = vi.fn();
    const unsub = subscribe(spy, db);
    await new Promise((r) => setTimeout(r, 5));
    spy.mockClear();
    unsub();
    await setTokens(
      {
        accessToken: 'AT',
        accessTokenExpiresAt: 999,
        scope: 'openid email profile',
      },
      db,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

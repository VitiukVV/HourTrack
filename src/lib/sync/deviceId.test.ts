import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HourTrackDB } from '@/lib/db/schema';
import { getSettings, initDB } from '@/lib/db/queries';

import { generateDeviceId, getOrCreateDeviceId, readDeviceId } from './deviceId';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-device-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
});

afterEach(async () => {
  await db.delete();
});

describe('deviceId', () => {
  it('generateDeviceId returns a v4-shaped uuid', () => {
    const id = generateDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('getOrCreateDeviceId generates + persists on first call', async () => {
    expect(await readDeviceId(db)).toBeNull();
    const id = await getOrCreateDeviceId(db);
    expect(id).toBeTruthy();
    const settings = await getSettings(db);
    expect(settings?.deviceId).toBe(id);
  });

  it('getOrCreateDeviceId returns the same id on subsequent calls', async () => {
    const first = await getOrCreateDeviceId(db);
    const second = await getOrCreateDeviceId(db);
    expect(second).toBe(first);
  });

  it('readDeviceId returns null when no device id has been generated yet', async () => {
    expect(await readDeviceId(db)).toBeNull();
  });
});

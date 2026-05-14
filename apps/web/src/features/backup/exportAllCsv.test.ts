import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HourTrackDB } from '@/lib/db/schema';
import { archiveCard, createCard, createEntry, initDB } from '@/lib/db/queries';

import { exportAllEntriesAsCsv } from './exportAllCsv';

let db: HourTrackDB;

beforeEach(async () => {
  db = new HourTrackDB(`hourtrack-export-${Math.random().toString(36).slice(2)}`);
  await db.open();
  await initDB(db);
  // Mock the DOM-driven download path so the test doesn't actually open a
  // download dialog. `downloadCsv` uses Blob + anchor.click; happy-dom
  // implements these, but jsdom-style mocks make the assertion clean.
  const anchorClickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined);
  // Object URL APIs aren't implemented in happy-dom by default.
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:fake'),
    });
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  }
  // Track so afterEach can restore.
  (db as unknown as { _spy: typeof anchorClickSpy })._spy = anchorClickSpy;
});

afterEach(async () => {
  await db.delete();
  vi.restoreAllMocks();
});

describe('exportAllEntriesAsCsv', () => {
  it('exports every entry across active AND archived cards', async () => {
    await createCard(db, {
      id: 'active',
      name: 'Active',
      color: '#3B82F6',
      defaultDurationMin: 480,
      rateType: 'hourly',
      hourlyRate: 20,
      fixedTotal: null,
      defaultNote: null,
      isArchived: false,
      archivedAt: null,
    });
    await createCard(db, {
      id: 'arch',
      name: 'Archived',
      color: '#EF4444',
      defaultDurationMin: 480,
      rateType: 'hourly',
      hourlyRate: 30,
      fixedTotal: null,
      defaultNote: null,
      isArchived: false,
      archivedAt: null,
    });
    // After both cards exist, archive one. Its prior entries must still
    // surface in the export with the card name resolved.
    await createEntry(db, {
      id: 'e-1',
      cardId: 'active',
      date: '2026-05-10',
      durationMin: 60,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });
    await createEntry(db, {
      id: 'e-2',
      cardId: 'arch',
      date: '2026-05-11',
      durationMin: 120,
      useCustomPayment: false,
      customPayment: null,
      note: null,
      googleEventId: null,
      syncStatus: 'pending',
      syncError: null,
    });
    await archiveCard(db, 'arch');

    const result = await exportAllEntriesAsCsv(db, new Date('2026-05-15T10:00:00Z'));
    expect(result.entryCount).toBe(2);
    expect(result.filename).toBe('hourtrack-export-2026-05-15.csv');
  });

  it('returns entryCount=0 for an empty DB', async () => {
    const result = await exportAllEntriesAsCsv(db, new Date('2026-05-15T10:00:00Z'));
    expect(result.entryCount).toBe(0);
  });
});

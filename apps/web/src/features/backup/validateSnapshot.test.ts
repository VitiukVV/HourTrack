import { describe, expect, it } from 'vitest';

import type { DriveSnapshot } from '@hourtrack/shared-types';

import { validateSnapshot } from './validateSnapshot';

function makeValidSnapshot(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 1,
    exportedAt: '2026-05-15T10:00:00.000Z',
    deviceId: '11111111-1111-4111-8111-111111111111',
    settings: {
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
    },
    cards: [
      {
        id: 'card-1',
        name: 'Test',
        color: '#3B82F6',
        defaultDurationMin: 480,
        rateType: 'hourly',
        hourlyRate: 20,
        fixedTotal: null,
        defaultNote: null,
        isArchived: false,
        archivedAt: null,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    entries: [
      {
        id: 'entry-1',
        cardId: 'card-1',
        date: '2026-05-14',
        durationMin: 240,
        useCustomPayment: false,
        customPayment: null,
        note: null,
        googleEventId: null,
        syncStatus: 'pending',
        syncError: null,
        createdAt: '2026-05-14T00:00:00.000Z',
        updatedAt: '2026-05-14T00:00:00.000Z',
      },
    ],
    tombstones: [],
    ...overrides,
  };
}

describe('validateSnapshot', () => {
  it('accepts a valid v1 snapshot', () => {
    const result = validateSnapshot(makeValidSnapshot());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.schemaVersion).toBe(1);
      expect(result.snapshot.cards).toHaveLength(1);
      expect(result.snapshot.entries).toHaveLength(1);
    }
  });

  it('accepts a v1 snapshot WITHOUT tombstones (pre-S10 backwards compat)', () => {
    const snap = makeValidSnapshot();
    delete (snap as { tombstones?: unknown }).tombstones;
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(true);
  });

  it('rejects schemaVersion 2 with a descriptive error', () => {
    const result = validateSnapshot(makeValidSnapshot({ schemaVersion: 2 as unknown as 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either zod's invalid_literal canned message OR our custom errorMap text
      // — both unambiguously identify a schema version mismatch.
      expect(result.error.toLowerCase()).toMatch(/schemaversion|expected/);
    }
  });

  it('rejects a malformed entry (missing durationMin)', () => {
    const snap = makeValidSnapshot();
    const broken = { ...snap.entries[0] } as Record<string, unknown>;
    delete broken.durationMin;
    snap.entries = [broken as unknown as DriveSnapshot['entries'][0]];
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('durationMin');
    }
  });

  it('rejects an entry with the wrong date format', () => {
    const snap = makeValidSnapshot();
    snap.entries[0]!.date = '14/05/2026'; // DD/MM/YYYY — not YYYY-MM-DD
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain('date');
    }
  });

  it('rejects when settings.autoBackupIntervalDays is out of bounds', () => {
    const snap = makeValidSnapshot();
    snap.settings.autoBackupIntervalDays = 999;
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
  });

  it('rejects null and non-object inputs', () => {
    expect(validateSnapshot(null).ok).toBe(false);
    expect(validateSnapshot('not an object').ok).toBe(false);
    expect(validateSnapshot(42).ok).toBe(false);
  });

  it('preserves unknown top-level fields via passthrough', () => {
    const snap = { ...makeValidSnapshot(), extraField: 'forward-compat' };
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(true);
  });
});

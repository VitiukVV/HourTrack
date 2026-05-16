import { describe, expect, it } from 'vitest';

import type { DriveSnapshot } from '@hourtrack/shared-types';

import { validateSnapshot } from './validateSnapshot';

/**
 * S16: this suite was rewritten as part of the v2 cutover. The pre-S16
 * version asserted v1 acceptance + v2 rejection; the new world is the
 * mirror image — v1 is rejected with the `versionMismatch` code, v2 is
 * the only accepted shape, and a v2 snapshot missing `startMinutes` or
 * `defaultStartMinutes` is rejected with the distinct `missingTimeField`
 * code so the Restore modal can render targeted copy.
 */

function makeValidSnapshot(overrides: Partial<DriveSnapshot> = {}): DriveSnapshot {
  return {
    schemaVersion: 2,
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
      onboardingSeen: false,
    },
    cards: [
      {
        id: 'card-1',
        name: 'Test',
        color: '#2563EB',
        defaultDurationMin: 480,
        defaultStartMinutes: 600,
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
        startMinutes: 600,
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
  it('accepts a valid v2 snapshot', () => {
    const result = validateSnapshot(makeValidSnapshot());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.schemaVersion).toBe(2);
      expect(result.snapshot.cards).toHaveLength(1);
      expect(result.snapshot.entries).toHaveLength(1);
    }
  });

  it('accepts a v2 snapshot WITHOUT tombstones (back-compat for early-v2 writers)', () => {
    const snap = makeValidSnapshot();
    delete (snap as { tombstones?: unknown }).tombstones;
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(true);
  });

  it('rejects a v1 snapshot with the `versionMismatch` code', () => {
    // Constructed as a literal v1 object — has no `startMinutes` /
    // `defaultStartMinutes` (which v1 didn't carry). The version gate must
    // fire BEFORE the time-field check so the user sees the right
    // "older app version" copy.
    const v1 = {
      schemaVersion: 1,
      exportedAt: '2026-04-01T00:00:00.000Z',
      deviceId: 'd',
      settings: makeValidSnapshot().settings,
      cards: [],
      entries: [],
      tombstones: [],
    };
    const result = validateSnapshot(v1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('versionMismatch');
      expect(result.error.toLowerCase()).toMatch(/schemaversion|version/);
    }
  });

  it('rejects a schemaVersion=3 snapshot with the `versionMismatch` code (future-format guard)', () => {
    const result = validateSnapshot(makeValidSnapshot({ schemaVersion: 3 as unknown as 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('versionMismatch');
    }
  });

  it('rejects a v2 snapshot where an entry is missing `startMinutes` with the `missingTimeField` code', () => {
    const snap = makeValidSnapshot();
    const broken = { ...snap.entries[0] } as Record<string, unknown>;
    delete broken.startMinutes;
    snap.entries = [broken as unknown as DriveSnapshot['entries'][0]];
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The distinct code is the contract — RestoreModal branches on it.
      expect(result.code).toBe('missingTimeField');
      // The error message MUST be distinguishable from the version-mismatch
      // copy. The simplest invariant is that it doesn't accidentally
      // mention "schemaVersion".
      expect(result.error.toLowerCase()).not.toContain('schemaversion');
    }
  });

  it('rejects a v2 snapshot where a card is missing `defaultStartMinutes` with the `missingTimeField` code', () => {
    const snap = makeValidSnapshot();
    const broken = { ...snap.cards[0] } as Record<string, unknown>;
    delete broken.defaultStartMinutes;
    snap.cards = [broken as unknown as DriveSnapshot['cards'][0]];
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missingTimeField');
    }
  });

  it('rejects a v2 snapshot with startMinutes out of [0, 1439] with `missingTimeField`', () => {
    const snap = makeValidSnapshot();
    snap.entries[0]!.startMinutes = 1440; // off-by-one out of range
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missingTimeField');
    }
  });

  it('rejects a malformed entry (missing durationMin) with the generic `malformed` code', () => {
    const snap = makeValidSnapshot();
    const broken = { ...snap.entries[0] } as Record<string, unknown>;
    delete broken.durationMin;
    snap.entries = [broken as unknown as DriveSnapshot['entries'][0]];
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('malformed');
      expect(result.error).toContain('durationMin');
    }
  });

  it('rejects an entry with the wrong date format as `malformed`', () => {
    const snap = makeValidSnapshot();
    snap.entries[0]!.date = '14/05/2026'; // DD/MM/YYYY — not YYYY-MM-DD
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('malformed');
      expect(result.error.toLowerCase()).toContain('date');
    }
  });

  it('rejects when settings.autoBackupIntervalDays is out of bounds as `malformed`', () => {
    const snap = makeValidSnapshot();
    snap.settings.autoBackupIntervalDays = 999;
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('malformed');
    }
  });

  it('rejects null and non-object inputs with `versionMismatch`', () => {
    // Null / primitives have no `schemaVersion` to inspect, so the
    // pre-zod version gate catches them first.
    for (const bad of [null, 'not an object', 42] as const) {
      const result = validateSnapshot(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('versionMismatch');
    }
  });

  it('preserves unknown top-level fields via passthrough', () => {
    const snap = { ...makeValidSnapshot(), extraField: 'forward-compat' };
    const result = validateSnapshot(snap);
    expect(result.ok).toBe(true);
  });
});

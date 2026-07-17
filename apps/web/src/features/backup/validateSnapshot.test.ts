import { describe, expect, it } from 'vitest';

import type { DriveSnapshot } from '@hourtrack/shared-types';

import { InvalidSnapshotError, validatePulledSnapshot, validateSnapshot } from './validateSnapshot';

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
        monthlyTotal: null,
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
  it('accepts a valid v2 snapshot and upgrades schemaVersion to 5 in-band (S21+S27+S28)', () => {
    const result = validateSnapshot(makeValidSnapshot());
    expect(result.ok).toBe(true);
    if (result.ok) {
      // S21 coerced v2 → v3 (monthlyTotal backfill); S27 extended the chain to
      // v4 (payments: [] backfill); S28 extends it to v5 (reminders: []
      // backfill). The fixture already has `monthlyTotal: null` so the
      // post-upgrade shape matches v5's contract verbatim.
      expect(result.snapshot.schemaVersion).toBe(5);
      expect(result.snapshot.payments).toEqual([]);
      expect(result.snapshot.reminders).toEqual([]);
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

  // S28: v3/v4/v5 are ACCEPTED schemaVersions. The future-format guard now
  // sits at v6 — see the 'rejects schemaVersion 6 (future)' test in the
  // upgrade describe block. v3 inputs are upgraded in-band to v5 (payments: []
  // + reminders: []).
  it('accepts a schemaVersion=3 snapshot and upgrades it to v5 (S21+S27+S28)', () => {
    const result = validateSnapshot(makeValidSnapshot({ schemaVersion: 3 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.schemaVersion).toBe(5);
      expect(result.snapshot.payments).toEqual([]);
      expect(result.snapshot.reminders).toEqual([]);
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

// S21 — v2 → v3 snapshot migration. v2 inputs (no `monthlyTotal` on cards)
// must still validate; the validator backfills `monthlyTotal: null` on each
// card in-band and coerces schemaVersion to 3. v3 inputs flow through
// unchanged.
describe('validateSnapshot — S21 v2 → v3 upgrade', () => {
  it('accepts a v2 snapshot whose cards lack monthlyTotal and backfills null', () => {
    // Build a v2-shape snapshot: strip monthlyTotal off the seeded card and
    // leave schemaVersion at 2. (validateSnapshot expects the in-band
    // upgrade to inject monthlyTotal=null before zod runs.)
    const v2Card = {
      id: 'card-v2',
      name: 'Legacy',
      color: '#2563EB',
      defaultDurationMin: 480,
      defaultStartMinutes: 600,
      rateType: 'hourly' as const,
      hourlyRate: 20,
      fixedTotal: null,
      // NO monthlyTotal here — that's the whole point of v2.
      defaultNote: null,
      isArchived: false,
      archivedAt: null,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    const v2Snapshot = {
      schemaVersion: 2,
      exportedAt: '2026-05-15T10:00:00.000Z',
      deviceId: '11111111-1111-4111-8111-111111111111',
      settings: makeValidSnapshot().settings,
      cards: [v2Card],
      entries: [],
      tombstones: [],
    };

    const result = validateSnapshot(v2Snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // schemaVersion coerced up to 5 (v2 → v3 → v4 → v5 chain).
      expect(result.snapshot.schemaVersion).toBe(5);
      // The backfilled card now carries monthlyTotal: null.
      expect(result.snapshot.cards).toHaveLength(1);
      expect(result.snapshot.cards[0]!.monthlyTotal).toBeNull();
      // Other fields are preserved verbatim.
      expect(result.snapshot.cards[0]!.id).toBe('card-v2');
      expect(result.snapshot.cards[0]!.hourlyRate).toBe(20);
    }
  });

  it('accepts a v3 snapshot with a monthly-rate card (round-trip identity)', () => {
    const v3Snapshot = {
      ...makeValidSnapshot(),
      schemaVersion: 3 as const,
      cards: [
        {
          id: 'mary',
          name: 'Mary',
          color: '#2563EB',
          defaultDurationMin: 0,
          defaultStartMinutes: 540,
          rateType: 'monthly' as const,
          hourlyRate: null,
          fixedTotal: null,
          monthlyTotal: 250,
          defaultNote: null,
          isArchived: false,
          archivedAt: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    };
    const result = validateSnapshot(v3Snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.cards[0]!.rateType).toBe('monthly');
      expect(result.snapshot.cards[0]!.monthlyTotal).toBe(250);
    }
  });

  it('rejects schemaVersion 1 with versionMismatch (no backward-compat to v1)', () => {
    const v1Snapshot = { ...makeValidSnapshot(), schemaVersion: 1 as unknown as 2 };
    const result = validateSnapshot(v1Snapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('versionMismatch');
    }
  });

  it('accepts a schemaVersion 4 snapshot with payments (S27, round-trip identity)', () => {
    const v4Snapshot = {
      ...makeValidSnapshot({ schemaVersion: 3 }),
      schemaVersion: 4 as unknown as 3,
      payments: [
        {
          id: 'pay-1',
          cardId: 'card-1',
          period: '2026-07',
          amount: 250,
          paidOn: '2026-08-04',
          note: null,
          createdAt: '2026-08-04T00:00:00.000Z',
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
      ],
    };
    const result = validateSnapshot(v4Snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // S28: v4 inputs are upgraded in-band to v5 (reminders: [] backfill).
      expect(result.snapshot.schemaVersion).toBe(5);
      expect(result.snapshot.payments).toHaveLength(1);
      expect(result.snapshot.payments?.[0]).toMatchObject({ amount: 250, period: '2026-07' });
      expect(result.snapshot.reminders).toEqual([]);
    }
  });

  it('rejects a v4 snapshot with a non-positive payment amount as malformed', () => {
    const bad = {
      ...makeValidSnapshot({ schemaVersion: 3 }),
      schemaVersion: 4 as unknown as 3,
      payments: [
        {
          id: 'pay-bad',
          cardId: 'card-1',
          period: '2026-07',
          amount: 0,
          paidOn: '2026-07-01',
          note: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    };
    const result = validateSnapshot(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('malformed');
    }
  });

  it('rejects schemaVersion 6 (future) with versionMismatch', () => {
    const futureSnapshot = { ...makeValidSnapshot(), schemaVersion: 6 as unknown as 2 };
    const result = validateSnapshot(futureSnapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('versionMismatch');
    }
  });

  it('v2 snapshot with multiple cards backfills every card independently', () => {
    const v2Snapshot = {
      schemaVersion: 2,
      exportedAt: '2026-05-15T10:00:00.000Z',
      deviceId: '11111111-1111-4111-8111-111111111111',
      settings: makeValidSnapshot().settings,
      cards: [
        {
          id: 'a',
          name: 'A',
          color: '#2563EB',
          defaultDurationMin: 60,
          defaultStartMinutes: 540,
          rateType: 'hourly' as const,
          hourlyRate: 20,
          fixedTotal: null,
          defaultNote: null,
          isArchived: false,
          archivedAt: null,
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
        {
          id: 'b',
          name: 'B',
          color: '#DC2626',
          defaultDurationMin: 120,
          defaultStartMinutes: 600,
          rateType: 'fixed' as const,
          hourlyRate: null,
          fixedTotal: 1000,
          defaultNote: null,
          isArchived: false,
          archivedAt: null,
          createdAt: '2026-05-02T00:00:00.000Z',
          updatedAt: '2026-05-02T00:00:00.000Z',
        },
      ],
      entries: [],
      tombstones: [],
    };
    const result = validateSnapshot(v2Snapshot);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.schemaVersion).toBe(5);
      expect(result.snapshot.cards[0]!.monthlyTotal).toBeNull();
      expect(result.snapshot.cards[1]!.monthlyTotal).toBeNull();
    }
  });
});

// S31 Task 8 (UR-31-6) — the pull-path guard reused by SyncManager + bootstrap.
describe('validatePulledSnapshot (S31 / UR-31-6)', () => {
  it('returns the validated, in-band-upgraded snapshot for a good pull', () => {
    const snapshot = validatePulledSnapshot(makeValidSnapshot());
    expect(snapshot.schemaVersion).toBe(5);
    expect(snapshot.payments).toEqual([]);
    expect(snapshot.reminders).toEqual([]);
  });

  it('throws a recoverable InvalidSnapshotError on a null cards array (truncated file)', () => {
    // v5 so the v2→v3 in-band upgrade (which would backfill null→[]) is skipped
    // and the null array reaches the zod shape check — the real corrupt-pull case.
    const corrupt = makeValidSnapshot({ schemaVersion: 5 });
    (corrupt as { cards: unknown }).cards = null;
    expect(() => validatePulledSnapshot(corrupt)).toThrow(InvalidSnapshotError);
    try {
      validatePulledSnapshot(corrupt);
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSnapshotError);
      expect((err as InvalidSnapshotError).code).toBe('malformed');
    }
  });

  it('throws InvalidSnapshotError with versionMismatch on an unknown schemaVersion', () => {
    const future = makeValidSnapshot({ schemaVersion: 99 as unknown as 5 });
    try {
      validatePulledSnapshot(future);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSnapshotError);
      expect((err as InvalidSnapshotError).code).toBe('versionMismatch');
    }
  });
});

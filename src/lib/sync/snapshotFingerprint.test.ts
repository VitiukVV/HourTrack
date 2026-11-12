import { describe, expect, it } from 'vitest';

import type { DriveSnapshot } from '@/shared/types';

import { sameRows, snapshotFingerprint } from './snapshotFingerprint';

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';

/** Only the fields the fingerprint reads; the rest of a row is irrelevant here. */
function snap(overrides: Record<string, unknown> = {}): DriveSnapshot {
  return {
    schemaVersion: 8,
    exportedAt: T1,
    deviceId: 'dev',
    settings: {},
    cards: [],
    entries: [],
    payments: [],
    reminders: [],
    monthAdjustments: [],
    shoppingItems: [],
    tombstones: [],
    ...overrides,
  } as unknown as DriveSnapshot;
}

const row = (id: string, updatedAt = T1) => ({ id, updatedAt });

describe('sameRows', () => {
  it('is true for identical rows regardless of order, exportedAt, deviceId or settings', () => {
    const a = snap({ cards: [row('a'), row('b')], exportedAt: T1, deviceId: 'x' });
    const b = snap({
      cards: [row('b'), row('a')],
      exportedAt: T2,
      deviceId: 'y',
      settings: { theme: 'dark' },
    });
    expect(sameRows(a, b)).toBe(true);
  });

  it.each(['cards', 'entries', 'payments', 'reminders', 'monthAdjustments', 'shoppingItems'])(
    'detects a newer row in %s',
    (store) => {
      const a = snap({ [store]: [row('r1', T1)] });
      const b = snap({ [store]: [row('r1', T2)] });
      expect(sameRows(a, b)).toBe(false);
    },
  );

  it.each(['payments', 'reminders', 'monthAdjustments', 'shoppingItems'])(
    'detects a row present only on one side in %s',
    (store) => {
      expect(sameRows(snap({ [store]: [row('r1')] }), snap())).toBe(false);
    },
  );

  it('treats a missing optional store as empty (older snapshot formats)', () => {
    const old = snap({ shoppingItems: undefined, monthAdjustments: undefined });
    expect(sameRows(old, snap())).toBe(true);
  });

  it('compares tombstones by type, id and deletedAt', () => {
    const t = { entityType: 'entry', entityId: 'e1', deletedAt: T1 };
    expect(sameRows(snap({ tombstones: [t] }), snap({ tombstones: [t] }))).toBe(true);
    expect(sameRows(snap({ tombstones: [t] }), snap())).toBe(false);
    expect(
      sameRows(snap({ tombstones: [t] }), snap({ tombstones: [{ ...t, deletedAt: T2 }] })),
    ).toBe(false);
    expect(
      sameRows(snap({ tombstones: [t] }), snap({ tombstones: [{ ...t, entityType: 'card' }] })),
    ).toBe(false);
  });

  it('does not confuse the same row moved to another store', () => {
    expect(snapshotFingerprint(snap({ cards: [row('x')] }))).not.toBe(
      snapshotFingerprint(snap({ entries: [row('x')] })),
    );
  });
});

import { describe, expect, it } from 'vitest';

import { isOverdue, paymentStatus } from './paymentStatus';

describe('paymentStatus', () => {
  it('is unpaid when nothing received', () => {
    expect(paymentStatus(250, 0)).toBe('unpaid');
  });

  it('is partial when 0 < received < expected', () => {
    expect(paymentStatus(250, 120)).toBe('partial');
  });

  it('is paid when received equals expected', () => {
    expect(paymentStatus(250, 250)).toBe('paid');
  });

  it('is paid (collapses) when received exceeds expected', () => {
    expect(paymentStatus(250, 300)).toBe('paid');
  });

  it('treats an orphan payment (expected 0, received > 0) as paid', () => {
    expect(paymentStatus(0, 50)).toBe('paid');
  });

  // S31 Task 1 — epsilon-tolerant classification. The Mark-paid dialog
  // pre-fills `Number(remaining.toFixed(2))`, so paying the DISPLAYED amount
  // leaves a sub-cent residue against the unrounded `expected`. Cent-level
  // float residue must never mark money as still owed (UR-31-1).
  describe('epsilon tolerance (S31 / UR-31-1)', () => {
    it('the audit repro — rate 40 €/h, 50-min entry, pay the displayed 33.33 → paid', () => {
      const expected = (50 / 60) * 40; // 33.33333333...
      expect(paymentStatus(expected, 33.33)).toBe('paid');
    });

    it('classifies exact-to-the-cent underpayment residue as paid, not partial', () => {
      // received is short by 0.0033... — well under half a cent (EPS 0.005).
      expect(paymentStatus(100.0033, 100)).toBe('paid');
    });

    it('still reports a genuine partial (short by more than half a cent)', () => {
      expect(paymentStatus(100, 99.5)).toBe('partial');
    });

    it('still reports unpaid for a dust-only receipt (received within EPS of 0)', () => {
      expect(paymentStatus(100, 0.004)).toBe('unpaid');
    });

    it('a genuine partial well below expected is still partial', () => {
      expect(paymentStatus(250, 120)).toBe('partial');
    });
  });
});

describe('isOverdue', () => {
  const today = new Date(2026, 6, 16); // 2026-07-16 (month index 6 = July), local

  it('is false for a fully-paid past month', () => {
    expect(isOverdue('2026-06', 'paid', today)).toBe(false);
  });

  it('is true for an unpaid past month', () => {
    expect(isOverdue('2026-06', 'unpaid', today)).toBe(true);
  });

  it('is true for a partially-paid past month', () => {
    expect(isOverdue('2026-05', 'partial', today)).toBe(true);
  });

  it('is false for the current month even when unpaid', () => {
    expect(isOverdue('2026-07', 'unpaid', today)).toBe(false);
  });

  it('is false for a future month', () => {
    expect(isOverdue('2026-08', 'unpaid', today)).toBe(false);
  });

  it('does not fire for a past month whose displayed amount was fully paid (S31)', () => {
    // Sub-cent residue used to leave the card `partial` → falsely overdue.
    const expected = (50 / 60) * 40; // 33.33333...
    const status = paymentStatus(expected, 33.33);
    expect(status).toBe('paid');
    expect(isOverdue('2026-06', status, today)).toBe(false);
  });
});

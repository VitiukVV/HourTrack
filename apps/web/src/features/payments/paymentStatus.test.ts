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
});

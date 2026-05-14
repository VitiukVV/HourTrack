import { describe, expect, it } from 'vitest';

import type { Card, Entry } from '@hourtrack/shared-types';

import { buildReportCsv } from './exportCsv';

function makeCard(overrides: Partial<Card> = {}): Card {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'card-1',
    name: 'Hourly',
    color: '#3B82F6',
    defaultDurationMin: 480,
    rateType: 'hourly',
    hourlyRate: 20,
    fixedTotal: null,
    defaultNote: null,
    isArchived: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  const now = '2026-05-01T00:00:00.000Z';
  return {
    id: 'entry-1',
    cardId: 'card-1',
    date: '2026-05-14',
    durationMin: 165,
    useCustomPayment: false,
    customPayment: null,
    note: null,
    googleEventId: null,
    syncStatus: 'pending',
    syncError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('buildReportCsv', () => {
  it('starts with a UTF-8 BOM so Excel opens it in the correct locale', () => {
    const csv = buildReportCsv([], []);
    // BOM is U+FEFF
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('emits the required header line second (after BOM)', () => {
    const csv = buildReportCsv([], []);
    const withoutBom = csv.slice(1);
    const firstLine = withoutBom.split('\r\n')[0];
    expect(firstLine).toBe(
      'date,card,durationMin,durationFormatted,useCustomPayment,customPayment,note,earnings',
    );
  });

  it('emits one row per entry with formatted duration', () => {
    const card = makeCard({ id: 'a', name: 'Hourly', hourlyRate: 10 });
    const entry = makeEntry({ cardId: 'a', durationMin: 165, date: '2026-05-14' });
    const csv = buildReportCsv([entry], [card]);
    const lines = csv.slice(1).split('\r\n');
    // Header + 1 data row + trailing empty (newline-terminated)
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('2026-05-14,Hourly,165,2H 45M,N,,27.50');
  });

  it('escapes commas, quotes, and newlines in note + name fields', () => {
    const card = makeCard({ id: 'a', name: 'Comma, In, Name', hourlyRate: 10 });
    const entry = makeEntry({
      cardId: 'a',
      durationMin: 60,
      note: 'has, comma "quote" and\nnewline',
    });
    const csv = buildReportCsv([entry], [card]);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toContain('"Comma, In, Name"');
    expect(lines[1]).toContain('"has, comma ""quote"" and\nnewline"');
  });

  it('emits Y/empty for custom payment columns', () => {
    const card = makeCard({ id: 'a', name: 'A', hourlyRate: 10 });
    const customEntry = makeEntry({
      id: 'e1',
      cardId: 'a',
      durationMin: 60,
      useCustomPayment: true,
      customPayment: 123.45,
    });
    const csv = buildReportCsv([customEntry], [card]);
    const dataLine = csv.slice(1).split('\r\n')[1]!;
    // useCustomPayment=Y, customPayment=123.45, earnings=123.45
    expect(dataLine).toContain(',Y,123.45,');
    expect(dataLine.endsWith(',123.45')).toBe(true);
  });

  it('emits the empty earnings string when card is unknown (orphan defense)', () => {
    const entry = makeEntry({ cardId: 'ghost' });
    const csv = buildReportCsv([entry], []);
    const dataLine = csv.slice(1).split('\r\n')[1]!;
    // No card => unknown name, zero earnings (we still emit the row so users
    // can see/fix the orphan)
    expect(dataLine).toContain(',?,'); // unknown card placeholder
    expect(dataLine.endsWith(',0.00')).toBe(true);
  });
});

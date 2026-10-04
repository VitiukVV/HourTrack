import 'fake-indexeddb/auto';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import '@/lib/i18n/i18n';

import { useDayPageController } from './useDayPageController';

/** Spec 008 — the day page's derived labels, tested without rendering it. */

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useDayPageController', () => {
  it('links to the neighbouring days across a month boundary', () => {
    const { result } = renderHook(() => useDayPageController('2026-03-01'), { wrapper });
    expect(result.current.prevDate).toBe('2026-02-28');
    expect(result.current.nextDate).toBe('2026-03-02');
  });

  it('capitalises the weekday and starts with an empty day and closed picker', () => {
    const { result } = renderHook(() => useDayPageController('2026-05-14'), { wrapper });
    expect(result.current.weekday).toMatch(/^[A-ZА-ЯІЇЄҐ]/);
    expect(result.current.totalMin).toBe(0);
    expect(result.current.pickerOpen).toBe(false);
  });
});

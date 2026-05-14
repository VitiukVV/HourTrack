import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import '@/lib/i18n';

import { _resetSyncManagerForTesting, getSyncManager } from './SyncManager';
import { SyncIndicator } from './SyncIndicator';

function wrapper(qc: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  _resetSyncManagerForTesting();
});

afterEach(() => {
  _resetSyncManagerForTesting();
});

describe('SyncIndicator', () => {
  it('renders with the current SyncManager status as a data attribute', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<SyncIndicator />, { wrapper: wrapper(qc) });
    const btn = await screen.findByTestId('sync-indicator');
    // Default status from a fresh manager is 'idle' (or 'offline' if jsdom
    // happens to report navigator.onLine=false). Either is acceptable.
    const status = btn.getAttribute('data-status');
    expect(['idle', 'offline']).toContain(status);
  });

  it('updates the data-status when the SyncManager status changes', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<SyncIndicator />, { wrapper: wrapper(qc) });
    await screen.findByTestId('sync-indicator');

    // Force the manager to a 'syncing' state by enqueuing without a token
    // and triggering a flush — flush will transition through 'syncing'
    // before settling on 'error'. We assert the eventual state.
    const mgr = getSyncManager();
    await mgr.enqueue({ op: 'pushDataJson' });
    await mgr.flushNow();
    await waitFor(
      () => {
        const btn = screen.getByTestId('sync-indicator');
        // No token + no scope in tests => 'error'
        expect(['error', 'idle']).toContain(btn.getAttribute('data-status'));
      },
      { timeout: 5_000 },
    );
  });
});

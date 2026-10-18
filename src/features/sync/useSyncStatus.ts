import { useEffect, useState } from 'react';

import { getSyncManager, type SyncStatus } from './SyncManager';

/**
 * Subscribe to the singleton SyncManager's status. Returns the current
 * status plus the last error message (if any).
 *
 * UI components (`SyncIndicator`) consume this hook; the SyncManager itself
 * is React-agnostic.
 */
export function useSyncStatus(): { status: SyncStatus; lastError?: string } {
  const [state, setState] = useState<{ status: SyncStatus; lastError?: string }>(() => {
    const mgr = getSyncManager();
    return { status: mgr.getStatus(), lastError: mgr.getLastError() };
  });

  useEffect(() => {
    const mgr = getSyncManager();
    const unsub = mgr.subscribe((status, lastError) => {
      setState({ status, lastError });
    });
    return unsub;
  }, []);

  return state;
}

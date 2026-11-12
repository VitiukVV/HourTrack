import { getSyncManager, type PullOutcome, type PullResult, type SyncManager } from './SyncManager';

/**
 * Session sync entry point: pull remote changes into this device.
 *
 * Spec 016 moved the whole pull → validate → LWW merge → apply → upload-if-
 * needed cycle into `SyncManager.syncCycle`, where it shares the flush lock,
 * the token renewal (a stale stored sign-in is renewed first, a 401 is
 * renewed and repeated once) and the revision check with every push. This
 * wrapper stays as the one entry point the session code (`sessionPull`,
 * `SyncOrchestrator`) calls.
 */

export type BootstrapOutcome = PullOutcome;
export type BootstrapResult = PullResult;

export function runBootstrap(manager: SyncManager = getSyncManager()): Promise<BootstrapResult> {
  return manager.pullNow();
}

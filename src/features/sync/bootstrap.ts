import {
  getSyncManager,
  type PullOptions,
  type PullOutcome,
  type PullResult,
  type SyncManager,
} from './SyncManager';

/**
 * Session sync entry point: pull remote changes into this device.
 *
 * The pull → validate → LWW merge → apply → upload-if-needed cycle lives in
 * `SyncManager.syncCycle`, where it shares the flush lock, the token renewal
 * (a stale stored sign-in is renewed first, a 401 is renewed and repeated
 * once) and the revision check with every push. This wrapper stays as the one
 * entry point the session code (`sessionPull`, `SyncOrchestrator`) calls.
 */

export type BootstrapResult = PullResult;

export function runBootstrap(
  manager: SyncManager = getSyncManager(),
  options: PullOptions = {},
): Promise<BootstrapResult> {
  return manager.pullNow(options);
}

/** Whether the pull reached Drive and left this device in step with it. */
export function isPullSuccess(outcome: PullOutcome): boolean {
  return outcome === 'created' || outcome === 'pulled' || outcome === 'unchanged';
}

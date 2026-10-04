import { toast } from 'sonner';

import i18n from '@/lib/i18n/i18n';

import { getSyncManager, type SyncManager } from './SyncManager';

export type SyncOp = Parameters<SyncManager['enqueue']>[0];

/** One toast however many ops a single write failed to queue. */
const ENQUEUE_FAILED_TOAST_ID = 'sync-enqueue-failed';

/**
 * Spec 009 — queue a sync op after a local write, fire-and-forget.
 *
 * A failed enqueue is a durability failure, not a diagnostic: the row is in
 * Dexie and the mutation resolved, but nothing was queued, so the sync
 * indicator stays idle and the change never leaves this device. So it is
 * logged AND told to the user. `onFailure` lets a caller also mark the row
 * (an entry whose Calendar op was lost shows the editor's retry button);
 * `toastKey` swaps in more specific copy.
 */
export function enqueueSync(
  op: SyncOp,
  tag: string,
  options: { onFailure?: (err: unknown) => void; toastKey?: string } = {},
): void {
  getSyncManager()
    .enqueue(op)
    .catch((err: unknown) => {
      reportEnqueueFailure(op, tag, err, options.toastKey);
      options.onFailure?.(err);
    });
}

/** The log + toast half of `enqueueSync`, for callers that await the enqueue. */
export function reportEnqueueFailure(
  op: SyncOp,
  tag: string,
  err: unknown,
  toastKey = 'sync.enqueueFailed',
): void {
  console.error(`[${tag}] enqueue ${op.op} failed:`, err);
  toast.error(i18n.t(toastKey), { id: ENQUEUE_FAILED_TOAST_ID });
}

import { toast } from 'sonner';

import i18n from '@/lib/i18n/i18n';

/** A burst of the same failure (a closed DB rejects every read) shows once. */
const REPEAT_WINDOW_MS = 5000;

/**
 * Spec 007 — last safety net for a promise rejection no caller handled (a
 * write that failed where nobody was listening). Logs it and tells the user
 * something went wrong, so a lost change is never invisible. Aborts are a
 * cancelled operation, not a failure, and stay quiet. Install after the
 * <Toaster> has mounted — toasts published before it subscribes are dropped.
 * Returns the uninstaller.
 */
export function installUnhandledRejectionToast(now: () => number = Date.now): () => void {
  let lastMessage: string | null = null;
  let lastAt = -Infinity;

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    if (reason instanceof DOMException && reason.name === 'AbortError') return;
    // Logged here; skip the browser's own "Uncaught (in promise)" duplicate.
    event.preventDefault();
    console.error('[hourtrack] unhandled rejection:', reason);
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message === lastMessage && now() - lastAt < REPEAT_WINDOW_MS) return;
    lastMessage = message;
    lastAt = now();
    toast.error(i18n.t('common.unexpectedError'));
  };
  window.addEventListener('unhandledrejection', onRejection);
  return () => window.removeEventListener('unhandledrejection', onRejection);
}

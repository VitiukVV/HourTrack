import { toast } from 'sonner';

import i18n from '@/lib/i18n/i18n';

/**
 * Spec 007 — last safety net for a promise rejection no caller handled (a
 * write that failed where nobody was listening). Logs it and tells the user
 * something went wrong, so a lost change is never invisible. Aborts are a
 * cancelled operation, not a failure, and stay quiet. Returns the uninstaller.
 */
export function installUnhandledRejectionToast(): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    if (reason instanceof DOMException && reason.name === 'AbortError') return;
    console.error('[hourtrack] unhandled rejection:', reason);
    toast.error(i18n.t('common.unexpectedError'));
  };
  window.addEventListener('unhandledrejection', onRejection);
  return () => window.removeEventListener('unhandledrejection', onRejection);
}

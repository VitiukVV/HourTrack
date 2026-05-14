import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/authContext';

import { listBackupFiles, type BackupFile } from './backupService';

/**
 * TanStack Query hook returning all backup snapshot files for the signed-in
 * user, newest-first.
 *
 * Query key: `['backups', 'list']`. After a create / restore / delete, callers
 * must `invalidateQueries({ queryKey: ['backups'] })` so the picker re-fetches.
 *
 * Gating:
 * - Disabled when the user isn't authed or no access token is available. We
 *   return an empty array (rather than `undefined`) so consumers can render a
 *   stable empty state.
 * - We don't gate on scope grant — `listBackupFiles` will surface a clean
 *   401/403 if Drive access was revoked; the SyncIndicator's reconsent toast
 *   handles the recovery flow.
 */
const BACKUPS_KEY = ['backups', 'list'] as const;

export function useBackupsList(): UseQueryResult<BackupFile[]> {
  const { status, tokens } = useAuth();
  const accessToken = tokens?.accessToken ?? null;
  return useQuery({
    queryKey: BACKUPS_KEY,
    enabled: status === 'authed' && accessToken != null,
    queryFn: async (): Promise<BackupFile[]> => {
      if (!accessToken) return [];
      return listBackupFiles({ accessToken });
    },
  });
}

/**
 * Helper consumers call after a successful create / restore / delete so the
 * picker re-fetches without needing to thread a `qc` ref through props.
 */
export function useInvalidateBackupsList(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['backups'] });
  };
}

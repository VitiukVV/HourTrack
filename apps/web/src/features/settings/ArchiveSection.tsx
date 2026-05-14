import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { Card } from '@hourtrack/shared-types';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ArchivedCardsList } from '@/features/cards/ArchivedCardsList';
import { useDeleteCardMutation } from '@/features/cards/useCards';

import { SettingsSection } from './SettingsSection';

/**
 * Card archive section for the Settings page. Reuses the S03
 * `<ArchivedCardsList />` component and wires the `onDeletePermanently`
 * handler to a double-confirm flow + `useDeleteCardMutation` from S08.
 *
 * Confirmation uses the shared `ConfirmDialog` component (S06 relocated it
 * to `components/`). The body string interpolates `{{card}}` so users know
 * exactly which card they're about to nuke. Success/failure surfaces as a
 * sonner toast.
 */
export function ArchiveSection() {
  const { t } = useTranslation();
  const deleteCard = useDeleteCardMutation();
  const [pending, setPending] = useState<Card | null>(null);

  const handleDeleteRequest = (card: Card) => setPending(card);

  const handleConfirmDelete = () => {
    const target = pending;
    if (!target) return;
    setPending(null);
    deleteCard
      .mutateAsync(target.id)
      .then(() => {
        toast.success(t('settings.archive.deleteSuccess', { card: target.name }));
      })
      .catch((err: unknown) => {
        console.error('[ArchiveSection] hard-delete failed:', err);
        toast.error(t('settings.archive.deleteFailed'));
      });
  };

  return (
    <SettingsSection
      title={t('settings.archive.title')}
      testId="settings-archive"
      subtitle={t('settings.archive.subtitle')}
    >
      <ArchivedCardsList onDeletePermanently={handleDeleteRequest} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t('settings.archive.deleteConfirm.title')}
        body={pending ? t('settings.archive.deleteConfirm.body', { card: pending.name }) : ''}
        confirmLabel={t('settings.archive.deletePermanently')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleConfirmDelete}
      />
    </SettingsSection>
  );
}

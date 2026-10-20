/**
 * Per-device «reminder notifications» switch (spec 013, FR-003), in
 * `localStorage` only — the OS permission it gates is per device too, so a
 * synced `Settings` field would turn notifications on for a phone that never
 * granted them. Mirrors `useWhatsNewSeen`: storage failures read as «off»
 * rather than taking the app down.
 */
export const NOTIFICATIONS_ENABLED_STORAGE_KEY = 'hourtrack:notificationsEnabled';

export function readNotificationsEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(NOTIFICATIONS_ENABLED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeNotificationsEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(NOTIFICATIONS_ENABLED_STORAGE_KEY, enabled ? '1' : '0');
  } catch (err) {
    // Storage blocked: the switch falls back to «off» next session.
    console.warn('[notificationPrefs] could not save the preference', err);
  }
}

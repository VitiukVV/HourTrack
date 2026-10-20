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

/** `false` when the choice could not be stored. */
export function writeNotificationsEnabled(enabled: boolean): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(NOTIFICATIONS_ENABLED_STORAGE_KEY, enabled ? '1' : '0');
    return true;
  } catch (err) {
    // The write is lost: the next read returns whatever was stored before
    // («off» when storage is fully blocked). Callers report it to the user.
    console.warn('[notificationPrefs] could not save the preference', err);
    return false;
  }
}

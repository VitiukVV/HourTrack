import { useCallback, useState } from 'react';

import { LATEST_CHANGELOG_VERSION } from './changelog';

/**
 * Tracks whether the user has opened the What's New page since the latest
 * changelog release, via `localStorage` only (mirrors `LANGUAGE_STORAGE_KEY`
 * in `lib/i18n.ts`). Deliberately NOT a synced `Settings` field: it's a pure
 * UI nicety with zero data-integrity value, so it skips the Dexie
 * version-bump + Drive snapshot `schemaVersion` bump + LWW-merge wiring that
 * a real synced field would require (see `onboardingSeen` for that cost).
 * Worst case on a second device: the "New" badge shows once more.
 */
export const WHATS_NEW_SEEN_STORAGE_KEY = 'hourtrack:whatsNewSeenVersion';

/**
 * Both accessors swallow failures: a browser with site data blocked (or
 * Safari private mode, where `setItem` throws on a zero quota) made the read
 * throw during render, which took the whole app down to the error screen for
 * the sake of a badge. Losing the flag just shows "New" again.
 */
function readStoredVersion(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredVersion(version: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, version);
  } catch {
    /* storage unavailable — the badge simply reappears next session */
  }
}

export interface UseWhatsNewSeenResult {
  hasUnseen: boolean;
  markSeen: () => void;
}

export function useWhatsNewSeen(): UseWhatsNewSeenResult {
  const [seenVersion, setSeenVersion] = useState<string | null>(readStoredVersion);

  const markSeen = useCallback(() => {
    if (LATEST_CHANGELOG_VERSION === null) return;
    writeStoredVersion(LATEST_CHANGELOG_VERSION);
    setSeenVersion(LATEST_CHANGELOG_VERSION);
  }, []);

  const hasUnseen = LATEST_CHANGELOG_VERSION !== null && seenVersion !== LATEST_CHANGELOG_VERSION;

  return { hasUnseen, markSeen };
}

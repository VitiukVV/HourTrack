/**
 * The «Можливості» block at the top of `/whats-new` — what the app can do and
 * how it works, one collapsed section per area (pattern taken from my-diary).
 * Every string lives in i18n under `whatsNew.guide.<key>.{title,items}`, so
 * this file is locale-free.
 *
 * Scope rule: 3–10 items per section, ≤220 characters each — an item says what
 * the app can do and how to reach it; it does not narrate the interface.
 * `guide.test.ts` holds the shape. Keeping the CONTENT true is part of the
 * release process: a release that adds or changes a capability updates its
 * line here in the same commit as its «Що нового» entry.
 */
export interface GuideSection {
  key: string;
  /** Emoji, not a lucide name: decorative, and costs no bundle. */
  emoji: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  { key: 'cards', emoji: '🗂️' },
  { key: 'calendar', emoji: '📅' },
  { key: 'entries', emoji: '📝' },
  { key: 'payments', emoji: '💶' },
  { key: 'shopping', emoji: '🛒' },
  { key: 'reports', emoji: '📊' },
  { key: 'reminders', emoji: '🔔' },
  { key: 'sync', emoji: '☁️' },
  { key: 'app', emoji: '📱' },
];

/**
 * Static, hand-maintained release list for the Settings "What's New" page
 * (S30). Newest first. Each entry's user-facing copy (title + bullet items)
 * lives in i18n under `whatsNew.releases.<i18nKey>.*` -- this file carries no
 * language strings so it never needs locale-parity edits itself.
 *
 * Convention: any sprint that ships a user-visible feature adds one entry
 * here (+ its i18n keys) as part of that sprint's own scope.
 */
export interface ChangelogRelease {
  version: string;
  /** ISO `YYYY-MM-DD`, rendered via `formatDate` (DD.MM.YYYY). */
  date: string;
  /** Segment under `whatsNew.releases.<i18nKey>.{title,items}`. */
  i18nKey: string;
}

export const CHANGELOG_RELEASES: ChangelogRelease[] = [
  { version: '1.4.0', date: '2026-08-30', i18nKey: 'v1_4_0' },
  { version: '1.3.9', date: '2026-08-30', i18nKey: 'v1_3_9' },
  { version: '1.3.8', date: '2026-08-30', i18nKey: 'v1_3_8' },
  { version: '1.3.7', date: '2026-08-30', i18nKey: 'v1_3_7' },
  { version: '1.3.6', date: '2026-08-30', i18nKey: 'v1_3_6' },
  { version: '1.3.5', date: '2026-08-30', i18nKey: 'v1_3_5' },
  { version: '1.3.4', date: '2026-08-30', i18nKey: 'v1_3_4' },
  { version: '1.3.3', date: '2026-08-15', i18nKey: 'v1_3_3' },
  { version: '1.3.2', date: '2026-07-17', i18nKey: 'v1_3_2' },
  { version: '1.3.1', date: '2026-07-17', i18nKey: 'v1_3_1' },
  { version: '1.3.0', date: '2026-07-17', i18nKey: 'v1_3_0' },
  { version: '1.2.0', date: '2026-07-17', i18nKey: 'v1_2_0' },
  { version: '1.1.0', date: '2026-07-16', i18nKey: 'v1_1_0' },
  { version: '1.0.1', date: '2026-07-13', i18nKey: 'v1_0_1' },
  { version: '1.0.0', date: '2026-07-12', i18nKey: 'v1_0_0' },
];

export const LATEST_CHANGELOG_VERSION = CHANGELOG_RELEASES[0]?.version ?? null;

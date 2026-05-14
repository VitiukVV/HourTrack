// @hourtrack/shared-types -- domain type definitions.
// All entities are plain `interface` / `type` exports. No runtime code lives
// in this package -- importers can use it with zero bundle impact.
//
// See `docs/PROJECT_PLAN.md` §7.1 for the canonical spec these types implement.

export type { Card, RateType } from './card';
export type { Entry, SyncStatus } from './entry';
export type { Settings, Language, Theme, CalendarView } from './settings';
export type { DriveSnapshot } from './snapshot';
export type { Tombstone, TombstoneEntityType } from './tombstone';

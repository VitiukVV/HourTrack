// The data layer: every IndexedDB read and write that features use, split by
// domain (spec 004). The shared write rules (`updatedAt` stamp, atomic patch,
// delete + tombstone) live in ./mutate; each domain's functions in ./repos.
// This barrel keeps every existing `@/lib/db/queries` import working.

export * from './repos/settings';
export * from './repos/cards';
export * from './repos/cardOrder';
export * from './repos/entries';
export * from './repos/payments';
export * from './repos/reminders';
export * from './repos/syncQueue';
export * from './repos/tombstones';

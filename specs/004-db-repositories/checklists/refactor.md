# Refactor Safety Checklist: Data layer split into repositories

**Purpose**: Requirements-quality review — behaviour preservation of the data layer
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the reviewer judged the requirement well-written; it does not mean the work is done.

- [ ] CHK001 - Is "identical transaction scope" defined per function (which tables) so it can be checked? [Clarity, Spec §FR-005]
- [ ] CHK002 - Is the exception for `lib/google/tokenStore.ts` justified (device-local, unsynced table)? [Assumption, Spec §SC-003]
- [ ] CHK003 - Does the spec state which retention value wins when the two pruners are unified (30 days both)? [Consistency, Spec §FR-004]
- [ ] CHK004 - Are reads that bypass the layer explicitly deferred with a target step? [Scope, Spec §Assumptions]
- [ ] CHK005 - Is the barrel compatibility requirement measurable (no test edits besides paths)? [Measurability, Spec §SC-001]

# Data, Sync & UX/Reports Requirements Checklist: Month expected-amount adjustment

**Purpose**: Unit-test the requirements for data/sync integrity and Payments↔Reports consistency
**Created**: 2026-10-19
**Feature**: [spec.md](../spec.md)

`[x]` = the reviewer judged the requirement well written; it does not mean the code is done.

## Data & Sync Integrity

- [ ] CHK001 - Is the uniqueness rule (at most one adjustment per client+month) stated together with what happens when two devices create one for the same client+month? [Consistency, Spec §Key Entities, US3-AS2]
- [ ] CHK002 - Is it specified that a reset must not be revived by an older copy on another device or in Drive? [Completeness, Spec §FR-007, US3-AS3]
- [ ] CHK003 - Are requirements defined for restoring a backup made after the feature on a device that has newer adjustments? [Coverage, Spec §FR-008, Gap]
- [ ] CHK004 - Is the fate of adjustments defined when the client card is permanently deleted? [Edge Case, Gap]
- [ ] CHK005 - Is the amount precision (cents) and upper bound stated unambiguously? [Clarity, Spec §FR-004]
- [ ] CHK006 - Is behaviour specified when saving or resetting an adjustment fails? [Exception Flow, Gap]

## UX

- [ ] CHK007 - Is the entry point (which element of the row opens the form) defined precisely enough to test? [Clarity, Spec §Assumptions]
- [ ] CHK008 - Is the adjusted-row presentation («€200 · calc. €250») defined for rows that are paid, partial and overdue alike? [Coverage, Spec §FR-005]
- [ ] CHK009 - Is the «Mark paid» prefill after an adjustment explicitly tied to the adjusted amount? [Consistency, Spec §FR-003]
- [ ] CHK010 - Is it stated whether reset needs a confirmation step? [Clarity, Spec §FR-006, Gap]
- [ ] CHK011 - Are localisation requirements (uk/en/es) covered for every new label, validation message and toast? [Completeness, Spec §FR-011]

## Reports Consistency

- [ ] CHK012 - Is the per-cleaning share rule for an adjusted month unambiguous for mixed custom-payment and regular cleanings? [Clarity, Spec §US4-AS2]
- [ ] CHK013 - Is the split rule defined when the calculated month is €0 and the month has no cleanings? [Edge Case, Spec §US4-AS2]
- [ ] CHK014 - Is it explicit which surfaces keep card-rate amounts, and is that boundary consistent with SC-002a? [Consistency, Spec §FR-010a]
- [ ] CHK015 - Is equality between the Payments row and the Reports month total stated with a rounding tolerance? [Measurability, Spec §SC-002a]
- [ ] CHK016 - Is Reports behaviour defined for the custom-range view that cuts a month in half? [Coverage, Spec §US4-AS3]

## Notes

- `/speckit-implement` reads checklist state but does not modify markers.

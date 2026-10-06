# UX & Data-Integrity Requirements Checklist: Mark paid from a cleaning's card

**Purpose**: Unit-test the spec's UX and data-integrity requirements before planning
**Created**: 2026-10-06
**Feature**: [spec.md](../spec.md)

`[x]` = the reviewer judged the requirement well-written; it does not mean implemented.

## UX — Completeness & Clarity

- [ ] CHK001 - Is the placement of the «Paid» action / «Paid €X» state within the cleaning card specified relative to Save/Delete? [Gap, Spec §FR-001, §FR-008]
- [ ] CHK002 - Is "not billed monthly" defined unambiguously for every rate type, including monthly cleanings with a custom amount? [Clarity, Spec §Edge Cases]
- [ ] CHK003 - Is the prefill when expected earnings are 0 consistent with the validation rule (amount > 0)? [Consistency, Spec §FR-002, §FR-006]
- [ ] CHK004 - Is the calendar «paid» mark's appearance and accessible label defined for month, week and day views? [Clarity, Spec §FR-009]
- [ ] CHK005 - Is the behaviour defined when the cleaning card has unsaved edits and the user presses «Paid»? [Gap]
- [ ] CHK006 - Are the confirmation / Undo texts and the remove-payment confirmation specified? [Completeness, Spec §FR-005, US2]

## Data integrity

- [ ] CHK007 - Is it specified that a cleaning has at most one linked payment, and what happens if sync brings in a second? [Gap, Spec §FR-008]
- [ ] CHK008 - Is the month a linked payment counts toward unambiguous when the paid date falls in a different month? [Clarity, Spec §FR-004]
- [ ] CHK009 - Are the effects of deleting a cleaning or dragging it to another month on its payment defined? [Coverage, Spec §Edge Cases]
- [ ] CHK010 - Is backward/forward compatibility of the link with older backups and older app versions stated? [Completeness, Spec §FR-010]
- [ ] CHK011 - Is it stated that linked payments count in Payments totals exactly like unlinked ones? [Consistency, Spec §FR-004, SC-002]
- [ ] CHK012 - Is the failure path (save/edit/remove fails) defined for the card flow, not only for creation? [Coverage, Spec §Edge Cases]

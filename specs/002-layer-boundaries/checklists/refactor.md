# Refactor Safety Checklist: Layer boundaries enforced by lint

**Purpose**: Requirements-quality review — layer-rule completeness, file moves, no behaviour change
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the reviewer judged the requirement well-written; it does not mean the work is done.
`/speckit-implement` reads these markers but does not change them.

## Requirement Completeness

- [ ] CHK001 - Are all four top-level layers (`app`, `pages`, `features`, `components`, `lib`) assigned an allowed/forbidden import set, with no layer left implicit? [Completeness, Spec §FR-001–FR-004]
- [ ] CHK002 - Is the status of `src/` root files (`App.tsx`, `main.tsx`) relative to the layer rules stated? [Gap]
- [ ] CHK003 - Is the position of `packages/shared-*` in the layer order stated? [Gap, Assumption]
- [ ] CHK004 - Are all importers of `calendarLocale` and `LanguageSwitcher` covered by the move requirement, including tests? [Completeness, Spec §FR-007]

## Requirement Clarity

- [ ] CHK005 - Is "test files are exempt" defined by a concrete filename pattern, and does it cover test helpers that are not `*.test.*`? [Clarity, Spec §FR-005]
- [ ] CHK006 - Is the set of shadcn vendor files that stay unlinted enumerated rather than described? [Clarity, Spec §FR-006]
- [ ] CHK007 - Is the target location of `calendarLocale` stated as a single path? [Clarity, Spec §Assumptions]

## Requirement Consistency

- [ ] CHK008 - Is FR-003 (`components ↛ features`) consistent with the rule that pages/app may import both, and with step 4 leaving feature↔feature imports allowed? [Consistency, Spec §Edge Cases]
- [ ] CHK009 - Does the "start as error" assumption agree with SC-003 (zero remaining violations)? [Consistency, Spec §Assumptions]

## Acceptance Criteria Quality

- [ ] CHK010 - Can SC-002 ("one error per edge") be verified for both alias and relative import forms? [Measurability, Spec §SC-002]
- [ ] CHK011 - Is "no behaviour change" tied to an objective signal (gate + build) rather than manual inspection only? [Measurability, Spec §FR-008, §SC-001]

## Edge Case Coverage

- [ ] CHK012 - Are type-only imports (`import type`) across a forbidden edge addressed — forbidden or allowed? [Edge Case, Gap]
- [ ] CHK013 - Are dynamic `import()` calls across a forbidden edge addressed? [Edge Case, Gap]

## Notes

- Depth: standard; audience: reviewer of the branch before the owner's PR.

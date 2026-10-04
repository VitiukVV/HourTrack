# Refactor Safety Checklist: Folder structure of app, pages and lib

**Purpose**: Requirements-quality review — completeness of the move map, path-sensitive code
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the reviewer judged the requirement well-written; it does not mean the work is done.

## Requirement Completeness

- [ ] CHK001 - Does the move map name a destination for every current file in `app/`, `pages/` and loose `lib/` files? [Completeness, Spec §FR-001–FR-003]
- [ ] CHK002 - Are all kinds of path references listed (static/dynamic imports, `vi.mock`, `import.meta.glob`, config files)? [Completeness, Spec §Edge Cases, §FR-004]

## Requirement Clarity

- [ ] CHK003 - Is the placement rule for `colors.ts` justified rather than arbitrary? [Clarity, Spec §Assumptions]
- [ ] CHK004 - Is "tests beside their page" unambiguous for pages that have no test? [Clarity, Spec §FR-002]

## Consistency

- [ ] CHK005 - Are the new folders consistent with the layer rules of spec 002 (`app` still the shell, `SHELL` list)? [Consistency]

## Acceptance Criteria Quality

- [ ] CHK006 - Is "no behaviour change" tied to an objective signal (unchanged test count + build)? [Measurability, Spec §SC-001]

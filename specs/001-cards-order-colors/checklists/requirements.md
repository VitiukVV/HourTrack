# Specification Quality Checklist: Cards — user-defined order + richer colour choice

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-10
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Both clarifications were settled with the user on 2026-09-10:

- **FR-004** — reorder by press-and-hold on the pill, then drag. Chosen over a permanent
  drag handle (would widen and clutter the pills, small touch target) and over a separate
  reorder screen (reliable but not in-place). Consequences captured as FR-014 (feedback for
  each phase of the gesture) and FR-015 (a non-drag path for keyboard and assistive tech).
- **FR-009** — keep the twelve presets *and* add a custom colour. Chosen over a larger
  fixed palette (would hit the same wall again) and over a picker-only choice (loses the
  two-tap pick and guaranteed-distinguishable colours). Consequences captured as FR-009a
  (readability guard instead of a silent unusable state) and FR-009b (the custom colour is
  offered back when editing the card again).

Everything else the source request left open was resolved with a documented default in the
Assumptions section: new and restored cards append to the end, non-preset colours map to
the nearest calendar colour, order belongs to the account rather than the device, and a
legacy colour behaves like a custom one.

Wording note: "connected calendar", "the synced snapshot" and "the other device of the
user" are used instead of product names to keep the spec implementation-agnostic; the
concrete services are named in the plan.

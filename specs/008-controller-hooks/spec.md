# Spec 008: Controller hooks for the large components

**Audit**: `docs/audit/2026-10-04-architecture-audit.md` step 7 (A9) · **Branch**: `feature/architecture-refactor`

## Context

Four components mix form state, derived values, mutations and markup in one body:
`EntryEditor` (647 lines), `CardForm` (583), `CardsHeader` (337), `DayPage` (323). Reading
the behaviour means scrolling through JSX; testing it means rendering the whole tree.

## Clarifications (decided by the implementer)

- Pure refactor: no behaviour change, no version bump. Known behaviour bugs found earlier
  (audit §6, e.g. a parent callback throwing after a successful save) are NOT fixed here.
- One controller per component, next to it: `use<Component>Controller.ts`. The component keeps
  the markup; the hook owns state, derived values, mutations and handlers.
- Existing component tests are the safety net and must pass unchanged; each controller gets a
  focused hook test for its non-trivial derivation.

## Requirements

- **FR-001**: `useEntryEditorController` — form, dirty reporting, end-time ↔ duration math,
  earnings preview, save/delete handlers, delete-confirm state.
- **FR-002**: `useCardFormController` — form + resolver, end-time math, rate-type fields.
- **FR-003**: `useCardsHeaderController` — modal/archive state, drag sensors, announcements,
  drag-end → reorder.
- **FR-004**: `useDayPageController` — date navigation values, the day/range/card reads,
  the picker state and pick → create handler.

## Success Criteria

- **SC-001**: Each component body is markup plus one controller call; each drops ≥ 30 % of its
  lines.
- **SC-002**: All existing tests pass untouched; gate + build + `pnpm e2e` pass.

# Implementation Plan: Controller hooks

**Spec**: `specs/008-controller-hooks/spec.md`

## Design

Move, don't rewrite: cut the logic block out of each component body verbatim into
`features/<x>/use<X>Controller.ts` (DayPage's into `pages/day/useDayPageController.ts`), return
what the JSX reads, and destructure it in the component. Module-level helpers (`entryToForm`,
`defaultsToForm`, schemas, resolvers) move with the hook when only the hook uses them. Comments
travel with their code. One component per batch, gate after each.

## Risks

- `useId`-derived field ids must stay identical (tests query by label) — `fieldId` moves into the
  controller unchanged.
- Hook order inside the controller must not depend on props that change between renders.

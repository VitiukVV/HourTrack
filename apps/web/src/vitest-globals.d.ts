/// <reference types="@testing-library/jest-dom" />

// Ambient extension that gives Vitest's `expect()` the matchers from
// @testing-library/jest-dom (e.g. `toBeInTheDocument`).
//
// The runtime side is wired in `vitest.setup.ts` via
// `import '@testing-library/jest-dom/vitest'`. That setup file lives under
// `tsconfig.node.json` (S02 W2 cleanup), so this ambient `.d.ts` is what
// surfaces the matcher types to source-side test files compiled under
// `tsconfig.app.json`.
export {};

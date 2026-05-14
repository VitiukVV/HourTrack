/// <reference types="@testing-library/jest-dom" />

// Ambient extension that gives Vitest's `expect()` the matchers from
// @testing-library/jest-dom (e.g. `toBeInTheDocument`).
//
// The runtime side is wired in `vitest.setup.ts` via
// `import '@testing-library/jest-dom/vitest'`. That setup file lives under
// `tsconfig.node.json` (S02 W2 cleanup), so this ambient `.d.ts` is what
// surfaces the matcher types to source-side test files compiled under
// `tsconfig.app.json`.

// Vite `define` injection: the build flips this to the app's package.json
// version string (e.g. `"0.0.0"`). At test time it stays `undefined`; the
// `AboutSection` consumer falls back to `'dev'` in that case.
declare const __APP_VERSION__: string | undefined;

export {};

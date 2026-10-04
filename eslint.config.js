// ESLint 9 flat config -- root
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

const WEB_SRC = 'apps/web/src';

/** The app shell: the `app/` dir plus the composition-root files at the src root. */
const SHELL = ['app', 'App', 'main'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * One forbidden layer edge: `files` (tests exempt) must not import any of
 * `targets` (src-relative paths such as `features` or `lib/db/schema`), by
 * alias or by a relative path climbing into them, statically or via `import()`.
 * Flat config replaces a rule's options per block, so a directory that has
 * several forbidden targets needs them all in ONE block.
 */
function layerBoundary(files, targets, message, paths = []) {
  const group = targets.flatMap((t) => [`@/${t}`, `@/${t}/**`, `**/../${t}`, `**/../${t}/**`]);
  const alternatives = targets.map(escapeRegExp).join('|');
  // no-restricted-imports does not see dynamic `import()`.
  const dynamicImport = `ImportExpression[source.value=/^(@\\/|(\\.\\.\\/)+)(${alternatives})(\\/|$)/]`;
  return {
    files,
    ignores: ['**/*.test.*'],
    rules: {
      'no-restricted-imports': ['error', { paths, patterns: [{ group, message }] }],
      'no-restricted-syntax': ['error', { selector: dynamicImport, message }],
    },
  };
}

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/dev-dist/**',
      '**/.vite/**',
      // Playwright artifacts: gitignored, but a local e2e run leaves them on
      // disk and `pnpm -F web lint` would then fail on ~4k errors inside the
      // bundled report viewer. CI never sees them (lint runs before e2e).
      '**/playwright-report/**',
      '**/test-results/**',
      // shadcn primitives are vendor code -- keep ESLint off them. Only these
      // files: our own components in the same folder (pickers, TimeInput) are linted.
      ...['button', 'dialog', 'dropdown-menu', 'input', 'popover', 'select', 'switch'].map(
        (name) => `${WEB_SRC}/components/ui/${name}.tsx`,
      ),
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // React 19 JSX runtime
      'react/prop-types': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  // Layer edges (spec 002). lib sits at the bottom, components and features
  // above it, pages and the app shell on top. Features may import each other.
  layerBoundary(
    [`${WEB_SRC}/lib/**/*.{ts,tsx}`],
    ['features', 'pages', ...SHELL, 'components'],
    'src/lib is the bottom layer: it must not import features, pages, app or components.',
  ),
  layerBoundary(
    [`${WEB_SRC}/features/**/*.{ts,tsx}`],
    ['pages', ...SHELL],
    'Features must not import pages or the app shell.',
  ),
  layerBoundary(
    [`${WEB_SRC}/components/**/*.{ts,tsx}`],
    ['features', 'pages', ...SHELL],
    'Shared components must not import features, pages or the app shell.',
  ),
  layerBoundary(
    [`${WEB_SRC}/pages/**/*.{ts,tsx}`],
    ['lib/db/schema'],
    'Pages must not import the raw schema module (lib/db/schema); use @/lib/db helpers or feature hooks.',
    // Spec 006: pages read through feature hooks (live reads), never the singleton.
    [
      {
        name: '@/lib/db',
        importNames: ['db'],
        message: 'Pages must not use the db singleton; read through a feature hook.',
      },
    ],
  ),
  {
    files: ['**/*.config.{js,ts,mjs,cjs}', '**/vite.config.*', '**/vitest.config.*'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);

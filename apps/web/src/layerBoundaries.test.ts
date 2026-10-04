import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Spec 002 — regression test for the layer edges in the root `eslint.config.js`.
 * `pnpm lint` only proves today's code is clean; this proves the rules still
 * fire (a later config block for the same rule silently replaces their options,
 * a widened ignore or a glob typo turns them off).
 */
// Default cwd is apps/web (where vitest and `pnpm lint` run); ESLint finds the
// root config from there and matches its globs relative to the repo root.
const eslint = new ESLint();

// The first lint loads the config and every plugin — seconds under a full
// parallel test run, past the default per-test timeout. Pay it once here.
beforeAll(async () => {
  await eslint.calculateConfigForFile('src/lib/a.ts');
}, 30_000);

async function isRestricted(filePath: string, code: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).some(
    (m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax',
  );
}

const staticImport = (spec: string) => `import x from '${spec}';\nexport default x;\n`;
const namedImport = (name: string, spec: string) =>
  `import { ${name} } from '${spec}';\nexport default ${name};\n`;
const voidedMutate =
  'declare const m: { mutateAsync(v: number): Promise<void> };\nvoid m.mutateAsync(1);\n';
const dynamicImport = (spec: string) => `export const load = () => import('${spec}');\n`;

describe.each([
  // lib is the bottom layer
  ['src/lib/a.ts', staticImport('@/features/calendar/MonthView'), true],
  ['src/lib/sub/a.ts', staticImport('../../components/ui/TimeInput'), true],
  ['src/lib/a.ts', staticImport('@/app'), true],
  ['src/lib/a.ts', staticImport('@/App'), true],
  ['src/lib/a.ts', staticImport('../main'), true],
  ['src/lib/a.ts', dynamicImport('@/features/x/a'), true],
  ['src/lib/a.ts', staticImport('@/lib/date'), false],
  // features: not pages / app
  ['src/features/x/a.ts', staticImport('../../app/AppLayout'), true],
  ['src/features/x/a.ts', staticImport('@/pages/DayPage'), true],
  ['src/features/x/a.ts', dynamicImport('@/pages/DayPage'), true],
  ['src/features/x/a.ts', staticImport('@/features/y/b'), false],
  ['src/features/x/a.ts', staticImport('../y/b'), false],
  // components: not features / pages / app (own files in components/ui included)
  ['src/components/ui/TimeInput.tsx', staticImport('@/features/x/a'), true],
  ['src/components/a.tsx', staticImport('@/features'), true],
  ['src/components/a.tsx', staticImport('@/lib/utils/utils'), false],
  // pages: not the raw schema, not the db singleton (spec 006 — read through hooks)
  ['src/pages/P.tsx', staticImport('@/lib/db/schema'), true],
  ['src/pages/P.tsx', namedImport('db', '@/lib/db'), true],
  ['src/pages/P.tsx', namedImport('getSettings', '@/lib/db'), false],
  ['src/pages/P.tsx', staticImport('@/features/x/a'), false],
  // spec 007: no voided mutateAsync — in every layer, the shell included
  ['src/features/x/a.tsx', voidedMutate, true],
  ['src/pages/P.tsx', voidedMutate, true],
  ['src/app/shell/S.tsx', voidedMutate, true],
  ['src/features/x/a.tsx', 'declare const m: { mutate(v: number): void };\nm.mutate(1);\n', false],
  ['src/features/x/a.test.tsx', voidedMutate, false],
  // tests are exempt
  ['src/lib/a.test.ts', staticImport('@/features/x/a'), false],
])('%s', (file, code, blocked) => {
  it(`${blocked ? 'rejects' : 'allows'} ${code.trim().split('\n')[0]}`, async () => {
    expect(await isRestricted(file, code)).toBe(blocked);
  });
});

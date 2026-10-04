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
const dynamicImport = (spec: string) => `export const load = () => import('${spec}');\n`;

const SRC = 'src';

describe.each([
  // lib is the bottom layer
  [`${SRC}/lib/a.ts`, staticImport('@/features/calendar/MonthView'), true],
  [`${SRC}/lib/sub/a.ts`, staticImport('../../components/ui/TimeInput'), true],
  [`${SRC}/lib/a.ts`, staticImport('@/app'), true],
  [`${SRC}/lib/a.ts`, staticImport('@/App'), true],
  [`${SRC}/lib/a.ts`, staticImport('../main'), true],
  [`${SRC}/lib/a.ts`, dynamicImport('@/features/x/a'), true],
  [`${SRC}/lib/a.ts`, staticImport('@/lib/date'), false],
  // features: not pages / app
  [`${SRC}/features/x/a.ts`, staticImport('../../app/AppLayout'), true],
  [`${SRC}/features/x/a.ts`, staticImport('@/pages/DayPage'), true],
  [`${SRC}/features/x/a.ts`, dynamicImport('@/pages/DayPage'), true],
  [`${SRC}/features/x/a.ts`, staticImport('@/features/y/b'), false],
  [`${SRC}/features/x/a.ts`, staticImport('../y/b'), false],
  // components: not features / pages / app (own files in components/ui included)
  [`${SRC}/components/ui/TimeInput.tsx`, staticImport('@/features/x/a'), true],
  [`${SRC}/components/a.tsx`, staticImport('@/features'), true],
  [`${SRC}/components/a.tsx`, staticImport('@/lib/utils'), false],
  // pages: not the raw schema
  [`${SRC}/pages/P.tsx`, staticImport('@/lib/db/schema'), true],
  [`${SRC}/pages/P.tsx`, staticImport('@/lib/db'), false],
  [`${SRC}/pages/P.tsx`, staticImport('@/features/x/a'), false],
  // tests are exempt
  [`${SRC}/lib/a.test.ts`, staticImport('@/features/x/a'), false],
])('%s', (file, code, blocked) => {
  it(`${blocked ? 'rejects' : 'allows'} ${code.trim().split('\n')[0]}`, async () => {
    expect(await isRestricted(file, code)).toBe(blocked);
  });
});

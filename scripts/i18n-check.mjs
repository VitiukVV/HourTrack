#!/usr/bin/env node
/**
 * i18n key checks across uk / en / es locales.
 *
 * Two independent passes:
 *   1. PARITY (S01) — every nested key in `en` exists in `uk` and `es` (and
 *      vice versa). Missing keys break i18n fallback.
 *   2. USAGE — every key defined in `en.json` is referenced somewhere under
 *      `apps/web/src/**` outside the locale files themselves. Detection is
 *      deliberately syntax-agnostic so it covers all the ways keys travel
 *      in this codebase: `t('a.b.c')`, JSX props like `titleKey="x.y"`,
 *      zod schema messages (`message: 'cards.validation.foo'`), object
 *      maps, etc. Dynamic template keys (`t(\`a.b.${x}\`)`) are picked up
 *      via prefix-matching so anything under that prefix counts as used.
 *
 * Runs as `pnpm i18n:check`; wired into CI.
 *
 * To allow-list a key that's only built at runtime from data, prefix it
 * with the `IGNORE_KEYS` env var as a comma-separated list of fully-
 * qualified keys.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const localesDir = resolve(repoRoot, 'apps', 'web', 'src', 'locales');
const sourceDir = resolve(repoRoot, 'apps', 'web', 'src');
const LANGS = ['uk', 'en', 'es'];
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const IGNORE_DIRS = new Set(['locales', 'node_modules', 'dist']);
/**
 * Keys that are intentionally defined but not yet rendered. Each entry must
 * cite the followup / sprint that will retire the placeholder.
 */
const KNOWN_PLACEHOLDERS = new Set([
  // S21 followup — data is computed by `computeReport`, UI line not built.
  // See docs/PIPELINE_JOURNAL.md (S21 closing notes, "ReportsMetrics: surface
  // `monthlyContribution` as a sub-line").
  'reports.metrics.monthlyContribution',
]);

const IGNORE_KEYS = new Set([
  ...KNOWN_PLACEHOLDERS,
  ...(process.env.IGNORE_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]);

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flatten(v, key)) out.add(nested);
    } else {
      out.add(key);
    }
  }
  return out;
}

function loadLocale(lang) {
  const path = resolve(localesDir, `${lang}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing locale file: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function walkSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkSourceFiles(full));
    } else if (SOURCE_EXTS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Concatenate all source under `apps/web/src` (outside locales/) into one
 * blob and collect literal template-string prefixes used in `t(\`x.${...}\`)`
 * patterns so we can prefix-match keys composed at render time.
 */
function buildSourceIndex(files) {
  const parts = [];
  const prefixes = new Set();
  const templateRe = /\bt\(\s*`([a-zA-Z][\w.]*)\$\{/g;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    parts.push(source);
    for (const m of source.matchAll(templateRe)) prefixes.add(m[1]);
  }
  return { blob: parts.join('\n'), prefixes };
}

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const sets = Object.fromEntries(LANGS.map((l) => [l, flatten(loadLocale(l))]));

let hasError = false;

// --- PARITY ----------------------------------------------------------------
const reference = sets.en;
for (const lang of LANGS) {
  if (lang === 'en') continue;
  const missing = [...reference].filter((k) => !sets[lang].has(k));
  const extra = [...sets[lang]].filter((k) => !reference.has(k));
  if (missing.length) {
    console.error(`[i18n:check] ${lang}.json missing ${missing.length} keys from en.json:`);
    missing.forEach((k) => console.error(`  - ${k}`));
    hasError = true;
  }
  if (extra.length) {
    console.error(`[i18n:check] ${lang}.json has ${extra.length} extra keys not in en.json:`);
    extra.forEach((k) => console.error(`  + ${k}`));
    hasError = true;
  }
}

// --- USAGE ----------------------------------------------------------------
const sourceFiles = walkSourceFiles(sourceDir);
const { blob, prefixes } = buildSourceIndex(sourceFiles);

function isKeyUsed(key) {
  if (IGNORE_KEYS.has(key)) return true;
  for (const p of prefixes) {
    if (key.startsWith(p)) return true;
  }
  // Literal occurrence anywhere in source — works for t('k'), JSX props
  // ("titleKey='x'"), zod schema messages, lookup tables, etc.
  return new RegExp(`(?<![\\w.])${escapeForRegex(key)}(?![\\w.])`).test(blob);
}

const unused = [...reference].filter((k) => !isKeyUsed(k)).sort();
if (unused.length) {
  console.error(
    `[i18n:check] ${unused.length} key(s) in en.json are not referenced anywhere under apps/web/src:`,
  );
  unused.forEach((k) => console.error(`  ✗ ${k}`));
  console.error(
    `[i18n:check] If a key is referenced indirectly (built from runtime data), allow-list it via the IGNORE_KEYS env var.`,
  );
  hasError = true;
}

if (hasError) {
  process.exit(1);
} else {
  console.log(
    `[i18n:check] OK -- ${LANGS.length} locales aligned on ${reference.size} keys; all keys are referenced (scanned ${sourceFiles.length} source files, ${prefixes.size} dynamic prefix(es)).`,
  );
}

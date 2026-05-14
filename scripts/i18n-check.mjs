#!/usr/bin/env node
/**
 * i18n key parity check across uk / en / es locales.
 * Per S01 sprint Notes: missing keys break i18n fallback. This script asserts
 * every nested key in `en` exists in `uk` and `es` (and vice-versa).
 * Runs as `pnpm i18n:check`; should be wired into CI.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, '..', 'apps', 'web', 'src', 'locales');
const LANGS = ['uk', 'en', 'es'];

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

const sets = Object.fromEntries(LANGS.map((l) => [l, flatten(loadLocale(l))]));

let hasError = false;
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

if (hasError) {
  process.exit(1);
} else {
  console.log(`[i18n:check] OK -- ${LANGS.length} locales aligned on ${reference.size} keys`);
}

import { describe, expect, it } from 'vitest';

/**
 * A field without the autofill opt-out is invisible in review: nothing renders
 * differently, no test fails, and the saved-card row only shows up over the
 * keyboard on a real phone. So this walks the source instead — a new
 * `<input>` / `<Input>` that skips `noAutofill()` fails here rather than on the
 * owner's device weeks later.
 *
 * Ported from my-diary (`src/lib/noAutofill.test.ts`), where the same row came
 * back twice after being "fixed" by hand.
 *
 * Source is read through Vite's `import.meta.glob` (not `node:fs`) so the app's
 * tsconfig, which has no node types, still typechecks this file.
 */

const SOURCES = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Field types the browser cannot mistake for payment data. */
const EXEMPT_TYPES = ['checkbox', 'radio', 'file', 'range', 'color'];

/** Blank out comments (keeping newlines, so line numbers stay honest) — an
 *  `<input>` quoted in a doc comment is prose, not a field. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * The attribute text of every `<input …>` and `<Input …>` in a file, with its
 * line number. `<Input>` counts because the primitive forwards whatever it is
 * given: if the guard watched only the lowercase tag, moving a field onto the
 * primitive would quietly exempt it.
 */
function inputTags(source: string): Array<{ attrs: string; line: number }> {
  const tags: Array<{ attrs: string; line: number }> = [];
  const re = /<(?:input|Input)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // Scan to the tag's own `>`, skipping the ones nested in `{…}` expressions
    // (e.g. `onChange={() => f(a > b)}`).
    let depth = 0;
    let end = m.index;
    for (let i = m.index; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) {
        end = i;
        break;
      }
    }
    tags.push({
      attrs: source.slice(m.index, end),
      line: source.slice(0, m.index).split('\n').length,
    });
  }
  return tags;
}

function eachInput(visit: (file: string, tag: { attrs: string; line: number }) => void): void {
  for (const [file, raw] of Object.entries(SOURCES)) {
    if (file.includes('.test.')) continue;
    // The primitive itself: its `<input>` has no `type` or `name` of its own —
    // those belong to the caller, and the call sites are what this walks.
    if (file.endsWith('components/ui/input.tsx')) continue;
    for (const tag of inputTags(stripComments(raw))) visit(file, tag);
  }
}

describe('every text-ish input opts out of autofill', () => {
  it('sees the inputs at all (guards the guard)', () => {
    let count = 0;
    eachInput(() => {
      count += 1;
    });
    expect(count).toBeGreaterThan(10);
  });

  it('has no input without noAutofill()', () => {
    const offenders: string[] = [];
    eachInput((file, tag) => {
      const type = /type="([a-z]+)"/.exec(tag.attrs)?.[1];
      if (type && EXEMPT_TYPES.includes(type)) return;
      if (!tag.attrs.includes('noAutofill(')) offenders.push(`${file}:${tag.line}`);
    });
    expect(offenders).toEqual([]);
  });

  it('gives every input an explicit type', () => {
    const offenders: string[] = [];
    eachInput((file, tag) => {
      // `type={…}` (computed) counts: the caller decided deliberately.
      if (!/type=("[a-z]+"|\{)/.test(tag.attrs)) offenders.push(`${file}:${tag.line}`);
    });
    expect(offenders).toEqual([]);
  });
});

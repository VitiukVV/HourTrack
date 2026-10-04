import { describe, expect, it } from 'vitest';

/**
 * Spec 005 (FR-006) — features may depend on each other in ONE direction
 * only. Builds the feature → feature graph from production sources (tests
 * may share fixtures across features) and fails with the cycle's path.
 */

const SOURCES = import.meta.glob<string>(
  ['./features/**/*.{ts,tsx}', '!./features/**/*.test.{ts,tsx}', '!./features/**/__tests__/**'],
  { query: '?raw', import: 'default', eager: true },
);
// `… from 'x'`, side-effect `import 'x'` and dynamic `import('x')`.
const SPECIFIER = /(?:from\s+|import\s*\(?\s*)'([^']+)'/g;

/** `./features/sync/x.ts` → `['sync', 'x.ts']` — path segments under features/. */
function segments(path: string): string[] {
  return path.replace(/^\.\/features\//, '').split('/');
}

function featureOf(path: string): string {
  return segments(path)[0]!;
}

/** The feature a relative specifier lands in, or null when it climbs out of features/. */
function resolveRelative(from: string, specifier: string): string | null {
  const parts = segments(from).slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (part !== '.') parts.push(part);
  }
  return parts.length > 1 ? parts[0]! : null;
}

function targetFeature(from: string, specifier: string): string | null {
  const alias = /^@\/features\/([^/']+)/.exec(specifier);
  if (alias) return alias[1]!;
  return specifier.startsWith('.') ? resolveRelative(from, specifier) : null;
}

function featureGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const [file, source] of Object.entries(SOURCES)) {
    const from = featureOf(file);
    const edges = graph.get(from) ?? new Set<string>();
    graph.set(from, edges);
    for (const [, specifier] of source.matchAll(SPECIFIER)) {
      const to = targetFeature(file, specifier!);
      if (to && to !== from) edges.add(to);
    }
  }
  return graph;
}

function findCycles(graph: Map<string, Set<string>>): string[] {
  const cycles = new Set<string>();
  const visit = (node: string, path: string[]) => {
    for (const next of graph.get(node) ?? []) {
      const at = path.indexOf(next);
      if (at < 0) {
        visit(next, [...path, next]);
        continue;
      }
      // Rotate so the alphabetically first feature leads — one entry per cycle.
      const loop = path.slice(at);
      const start = loop.indexOf([...loop].sort()[0]!);
      const rotated = [...loop.slice(start), ...loop.slice(0, start)];
      cycles.add([...rotated, rotated[0]].join(' → '));
    }
  };
  for (const node of graph.keys()) visit(node, [node]);
  return [...cycles].sort();
}

describe('feature dependency graph', () => {
  it('has no cycles between features', () => {
    expect(findCycles(featureGraph())).toEqual([]);
  });
});

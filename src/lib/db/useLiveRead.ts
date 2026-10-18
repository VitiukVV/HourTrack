import { useLiveQuery } from 'dexie-react-hooks';

/**
 * What a read hook hands to components. The field names match the TanStack
 * results the app used before spec 006, so components did not change.
 */
export interface LiveRead<T> {
  data: T | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
}

type Answer<T> = { key: string; ok: true; value: T } | { key: string; ok: false; error: Error };

const DISABLED: LiveRead<never> = {
  data: undefined,
  isLoading: false,
  isSuccess: false,
  isError: false,
  error: null,
};

/**
 * Spec 006 — the one way to read Dexie from a component. Built on
 * `useLiveQuery`, so it re-runs after any committed write to the tables the
 * query touched: a form save, a sync pull, a restore, a Calendar stamp. No
 * caller ever invalidates anything.
 *
 * `key` must encode every input the query closes over. It does two jobs:
 *   - it is the dependency that restarts the query;
 *   - an answer is shown only while its key is current. `useLiveQuery` keeps
 *     returning the previous answer while new deps load, which would put the
 *     previous day's rows under the next day's header.
 *
 * A failing query is caught here and reported as `isError`: `useLiveQuery`
 * would otherwise rethrow it during render and take the screen down.
 */
export function useLiveRead<T>(key: string, query: () => Promise<T>, enabled = true): LiveRead<T> {
  const answer = useLiveQuery(
    async (): Promise<Answer<T> | null> => {
      if (!enabled) return null;
      try {
        return { key, ok: true, value: await query() };
      } catch (err) {
        console.error(`[useLiveRead] query "${key}" failed:`, err);
        return { key, ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    // `query` is deliberately not a dependency: it is a new closure every
    // render, and `key` already names everything it reads.
    [key, enabled],
  );

  if (!enabled) return DISABLED;
  if (!answer || answer.key !== key) {
    return { data: undefined, isLoading: true, isSuccess: false, isError: false, error: null };
  }
  if (!answer.ok) {
    return {
      data: undefined,
      isLoading: false,
      isSuccess: false,
      isError: true,
      error: answer.error,
    };
  }
  return { data: answer.value, isLoading: false, isSuccess: true, isError: false, error: null };
}

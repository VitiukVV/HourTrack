import { vi } from 'vitest';

/** The slice of Node's `process` this helper needs (the app tsconfig has no node types). */
interface NodeProcessEvents {
  listeners(event: 'unhandledRejection'): Array<(...args: unknown[]) => void>;
  removeAllListeners(event: 'unhandledRejection'): void;
  on(event: 'unhandledRejection', listener: (...args: unknown[]) => void): void;
}

/**
 * Run `body` with the process' unhandled-rejection listeners swapped for a
 * spy, so a rejection the code under test deliberately leaves to the global
 * net (spec 009: a throw from a parent callback after a successful save) is
 * observed by the test instead of failing the run.
 */
export async function withUnhandledRejections(
  body: (unhandled: ReturnType<typeof vi.fn>) => Promise<void>,
): Promise<void> {
  const process = (globalThis as unknown as { process: NodeProcessEvents }).process;
  const runnerListeners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    await body(unhandled);
  } finally {
    process.removeAllListeners('unhandledRejection');
    for (const l of runnerListeners) process.on('unhandledRejection', l);
  }
}

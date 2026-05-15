import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

import { db, initDB, updateSettings } from '@/lib/db';
import { OnboardingProvider } from './OnboardingProvider';
import { useOnboarding, type OnboardingContextValue } from './onboardingContext';

/**
 * Mock the auth context. The provider's gating logic reads `useAuth().status`
 * and only activates the tour when authed. By stubbing the hook we avoid
 * setting up an entire AuthProvider + token store in the test.
 */
const authStatusRef = { current: 'authed' as 'loading' | 'anonymous' | 'authed' };
vi.mock('@/features/auth/authContext', () => ({
  useAuth: () => ({
    status: authStatusRef.current,
    user: null,
    tokens: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <OnboardingProvider>{children}</OnboardingProvider>
      </QueryClientProvider>
    );
  };
}

function freshQc(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

async function setUpAuthed(firstLoginAt: string | null, onboardingSeen: boolean) {
  await db.delete();
  await db.open();
  await initDB(db);
  await updateSettings(db, { firstLoginAt, onboardingSeen });
}

describe('OnboardingProvider', () => {
  beforeEach(() => {
    authStatusRef.current = 'authed';
  });

  afterEach(async () => {
    await db.delete();
  });

  it('does NOT activate when onboardingSeen is true', async () => {
    await setUpAuthed('2026-05-15T10:00:00.000Z', true);
    const qc = freshQc();
    const { result } = renderHook(() => useOnboarding(), { wrapper: wrapper(qc) });
    // Wait for the first settings query to resolve.
    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    // Tour should remain inactive — onboardingSeen=true.
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.isActive).toBe(false);
  });

  it('does NOT activate when firstLoginAt is null', async () => {
    await setUpAuthed(null, false);
    const qc = freshQc();
    const { result } = renderHook(() => useOnboarding(), { wrapper: wrapper(qc) });
    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.isActive).toBe(false);
  });

  it('does NOT activate when auth is anonymous', async () => {
    authStatusRef.current = 'anonymous';
    await setUpAuthed('2026-05-15T10:00:00.000Z', false);
    const qc = freshQc();
    const { result } = renderHook(() => useOnboarding(), { wrapper: wrapper(qc) });
    await waitFor(() => {
      expect(result.current).toBeDefined();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.isActive).toBe(false);
  });

  it('activates on Step 1 when authed + firstLoginAt set + onboardingSeen false', async () => {
    await setUpAuthed('2026-05-15T10:00:00.000Z', false);
    const qc = freshQc();
    const { result } = renderHook(() => useOnboarding(), { wrapper: wrapper(qc) });
    await waitFor(
      () => {
        expect(result.current.isActive).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(result.current.currentStep).toBe(1);
  });

  it('skip() persists onboardingSeen=true and deactivates', async () => {
    await setUpAuthed('2026-05-15T10:00:00.000Z', false);
    const qc = freshQc();
    let captured: OnboardingContextValue | null = null;
    const { result } = renderHook(
      () => {
        const ctx = useOnboarding();
        captured = ctx;
        return ctx;
      },
      { wrapper: wrapper(qc) },
    );
    await waitFor(
      () => {
        expect(result.current.isActive).toBe(true);
      },
      { timeout: 2000 },
    );
    act(() => {
      captured!.skip();
    });
    expect(result.current.isActive).toBe(false);
    // Settings should be written to Dexie.
    await waitFor(async () => {
      const settings = await db.settings.get('current');
      expect(settings?.onboardingSeen).toBe(true);
    });
  });

  it('next() advances through 1 → 2 → 3, then completes on Step 3', async () => {
    await setUpAuthed('2026-05-15T10:00:00.000Z', false);
    const qc = freshQc();
    let captured: OnboardingContextValue | null = null;
    const { result } = renderHook(
      () => {
        const ctx = useOnboarding();
        captured = ctx;
        return ctx;
      },
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.isActive).toBe(true);
    });
    expect(result.current.currentStep).toBe(1);
    act(() => captured!.next());
    expect(result.current.currentStep).toBe(2);
    act(() => captured!.next());
    expect(result.current.currentStep).toBe(3);
    act(() => captured!.next());
    // Step 3 next → complete → isActive=false + onboardingSeen=true
    expect(result.current.isActive).toBe(false);
    await waitFor(async () => {
      const settings = await db.settings.get('current');
      expect(settings?.onboardingSeen).toBe(true);
    });
  });

  it('back() decrements step but stays at 1 when already at 1', async () => {
    await setUpAuthed('2026-05-15T10:00:00.000Z', false);
    const qc = freshQc();
    let captured: OnboardingContextValue | null = null;
    const { result } = renderHook(
      () => {
        const ctx = useOnboarding();
        captured = ctx;
        return ctx;
      },
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.isActive).toBe(true);
    });
    act(() => captured!.next());
    expect(result.current.currentStep).toBe(2);
    act(() => captured!.back());
    expect(result.current.currentStep).toBe(1);
    // Already at 1 — should stay.
    act(() => captured!.back());
    expect(result.current.currentStep).toBe(1);
  });

  it('does NOT re-activate within the same session after dismissal even if cache reverts', async () => {
    await setUpAuthed('2026-05-15T10:00:00.000Z', false);
    const qc = freshQc();
    let captured: OnboardingContextValue | null = null;
    const { result } = renderHook(
      () => {
        const ctx = useOnboarding();
        captured = ctx;
        return ctx;
      },
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.isActive).toBe(true);
    });
    act(() => captured!.skip());
    expect(result.current.isActive).toBe(false);
    // Simulate a stale cache write that puts onboardingSeen back to false.
    qc.setQueryData(['settings'], {
      ...((qc.getQueryData(['settings']) as object | undefined) ?? {}),
      firstLoginAt: '2026-05-15T10:00:00.000Z',
      onboardingSeen: false,
    });
    await new Promise((r) => setTimeout(r, 50));
    // Tour must STAY inactive because the in-session guard sticks.
    expect(result.current.isActive).toBe(false);
  });
});

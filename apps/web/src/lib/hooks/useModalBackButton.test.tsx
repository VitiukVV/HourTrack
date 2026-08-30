import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModalBackButton } from './useModalBackButton';

/**
 * happy-dom's `history.back()` doesn't synchronously emit `popstate` the way
 * real browsers do, so we exercise the hook's two seams directly:
 *
 *   - `history.pushState` / `history.back` — spied via `vi.spyOn` to verify
 *     the hook pushes a marker on open and pops it on UI-driven close.
 *   - `popstate` event — dispatched via `window.dispatchEvent` after
 *     manipulating `history.state` to simulate the new top-of-stack the
 *     browser would surface after a real back press.
 *
 * This pattern is decoupled from whichever version of happy-dom is in tree
 * and exercises the same code paths a production user-agent would.
 */
describe('useModalBackButton', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;
  let backSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    pushStateSpy = vi.spyOn(window.history, 'pushState');
    backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {
      // Don't let `history.back()` actually navigate during tests — we only
      // assert it was called. A real browser would pop + emit popstate.
    });
  });

  afterEach(() => {
    pushStateSpy.mockRestore();
    backSpy.mockRestore();
    window.history.replaceState(null, '');
  });

  function firePopState() {
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }

  it('is a no-op while `active` is false', () => {
    const onBack = vi.fn();
    renderHook(({ active }) => useModalBackButton(active, onBack), {
      initialProps: { active: false },
    });
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('pushes a marker state when `active` flips to true', () => {
    renderHook(({ active }) => useModalBackButton(active, vi.fn()), {
      initialProps: { active: true },
    });
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    const [marker] = pushStateSpy.mock.calls[0]!;
    expect(marker).toMatchObject({ __modalId: expect.any(Number) });
  });

  it('fires `onBack` when popstate moves history off the marker', () => {
    const onBack = vi.fn();
    renderHook(() => useModalBackButton(true, onBack));
    // The browser popped our marker → history.state is now the previous
    // entry's state (null here for the test baseline).
    window.history.replaceState(null, '');
    act(() => {
      firePopState();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire `onBack` when popstate fires but the marker is still on top', () => {
    // This simulates the "nested modal" branch: a sibling/child modal popped
    // ITS marker; our marker is still in `history.state`, so we should
    // no-op and let the topmost listener handle the back.
    const onBack = vi.fn();
    renderHook(() => useModalBackButton(true, onBack));
    // Marker is currently in history.state (set by the hook's pushState).
    act(() => {
      firePopState();
    });
    expect(onBack).not.toHaveBeenCalled();
  });

  it('pops the marker via history.back() when active flips to false', () => {
    const onBack = vi.fn();
    const { rerender } = renderHook(({ active }) => useModalBackButton(active, onBack), {
      initialProps: { active: true },
    });
    expect(backSpy).not.toHaveBeenCalled();

    rerender({ active: false });

    expect(backSpy).toHaveBeenCalledTimes(1);
    // Closing via UI must not double-fire `onBack` (otherwise consumers
    // would attempt to close an already-closed modal in a loop).
    expect(onBack).not.toHaveBeenCalled();
  });

  it('does NOT call history.back() when the modal closed BECAUSE of a popstate', () => {
    // If the user pressed back, the marker has already been popped by the
    // browser. The cleanup must detect this and NOT call back() a second
    // time, otherwise it would pop an extra (unrelated) history entry.
    const onBack = vi.fn();
    const { rerender } = renderHook(({ active }) => useModalBackButton(active, onBack), {
      initialProps: { active: true },
    });
    // Simulate browser-driven pop: marker is gone from history.state.
    window.history.replaceState(null, '');
    act(() => {
      firePopState();
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    // The consumer responds to onBack by setting active=false. Cleanup runs.
    rerender({ active: false });
    expect(backSpy).not.toHaveBeenCalled();
  });

  it('carries react-router history bookkeeping over instead of replacing it', () => {
    // React Router re-reads `idx` from the live history state on every push
    // and pop. Clobbering it here made `navigate()` from inside an open modal
    // write `idx: NaN` forward, after which back stopped reaching the router.
    window.history.replaceState({ idx: 3, key: 'abc', usr: null }, '');
    renderHook(() => useModalBackButton(true, vi.fn()));

    const [marker] = pushStateSpy.mock.calls[0]!;
    expect(marker).toMatchObject({ idx: 4, key: 'abc', __modalId: expect.any(Number) });
  });

  it('re-arms when `onBack` leaves the modal open (dirty-discard confirm)', () => {
    // EntryEditModal answers a close request on a dirty form by opening the
    // confirm and staying open. The entry is already spent, so without a
    // re-push the next back press would leave the page.
    const onBack = vi.fn();
    const { rerender } = renderHook(({ active }) => useModalBackButton(active, onBack), {
      initialProps: { active: true },
    });
    expect(pushStateSpy).toHaveBeenCalledTimes(1);

    window.history.replaceState(null, '');
    act(() => {
      firePopState();
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    // The consumer re-renders still-open.
    rerender({ active: true });
    expect(pushStateSpy).toHaveBeenCalledTimes(2);

    // And the re-armed entry is popped normally when the modal finally closes.
    rerender({ active: false });
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm on an ordinary re-render while the entry is still up', () => {
    const { rerender } = renderHook(({ active }) => useModalBackButton(active, vi.fn()), {
      initialProps: { active: true },
    });
    rerender({ active: true });
    rerender({ active: true });
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
  });

  it('reads the latest `onBack` closure across re-renders', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useModalBackButton(true, cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    window.history.replaceState(null, '');
    act(() => {
      firePopState();
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

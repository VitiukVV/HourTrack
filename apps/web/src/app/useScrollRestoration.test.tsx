import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __clearScrollStore,
  readScroll,
  saveScroll,
  useScrollRestoration,
} from './useScrollRestoration';

/**
 * The app scrolls `<body>`, not the window (see `lib/scroll.ts`), so the hook
 * is exercised against a `<body>` whose metrics are stubbed — happy-dom lays
 * nothing out and reports every dimension as 0, which would make "restore to
 * 240" indistinguishable from "restore to nothing".
 */
function setBodyMetrics(scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(document.body, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(document.body, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  });
}

function scrollBodyTo(top: number): void {
  document.body.scrollTop = top;
  // Scroll events don't bubble; the hook listens on `document` in the capture
  // phase, which a dispatch on `<body>` still passes through.
  document.body.dispatchEvent(new Event('scroll'));
}

function Layout() {
  useScrollRestoration();
  const navigate = useNavigate();
  return (
    <>
      <button data-testid="go" onClick={() => void navigate('/day/2026-01-05')}>
        go
      </button>
      <button data-testid="back" onClick={() => void navigate(-1)}>
        back
      </button>
      <Outlet />
    </>
  );
}

function Harness() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<div data-testid="home">home</div>} />
          <Route path="day/:date" element={<div data-testid="day">day</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  __clearScrollStore();
  document.body.scrollTop = 0;
  setBodyMetrics(2000, 800);
});

afterEach(() => {
  __clearScrollStore();
  document.body.scrollTop = 0;
});

describe('useScrollRestoration', () => {
  it('restores the position when navigating back, and starts at the top going forward', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    scrollBodyTo(240);
    await user.click(screen.getByTestId('go'));
    await screen.findByTestId('day');

    // Forward navigation lands at the top of the new page.
    expect(document.body.scrollTop).toBe(0);

    await user.click(screen.getByTestId('back'));
    await screen.findByTestId('home');
    await waitFor(() => expect(document.body.scrollTop).toBe(240));
  });

  it('keeps the observed position when the browser clamped scrollTop to 0 on the way out', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    scrollBodyTo(900);
    // The day page is far shorter than the month, so by the time the cleanup
    // runs the browser has already clamped the scroller to 0. Persisting THAT
    // is what made "back" land at the top.
    setBodyMetrics(1000, 800);
    document.body.scrollTop = 0;

    await user.click(screen.getByTestId('go'));
    await screen.findByTestId('day');

    setBodyMetrics(2000, 800);
    await user.click(screen.getByTestId('back'));
    await screen.findByTestId('home');
    await waitFor(() => expect(document.body.scrollTop).toBe(900));
  });

  it('caps the store so a long session cannot grow it without limit', () => {
    for (let i = 0; i < 40; i += 1) saveScroll(`key-${i}`, i + 1);
    // The 10 oldest entries are evicted; the newest 30 survive.
    expect(readScroll('key-9')).toBeUndefined();
    expect(readScroll('key-10')).toBe(11);
    expect(readScroll('key-39')).toBe(40);
  });

  it('survives sessionStorage being unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('denied');
      },
    });
    try {
      // Private mode / blocked storage must not take the app down with it.
      expect(() => saveScroll('k', 10)).not.toThrow();
      expect(readScroll('k')).toBeUndefined();
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});

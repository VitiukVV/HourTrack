import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/lib/i18n';
import i18n from '@/lib/i18n';
import { dbInterrupted, useDbStatus } from '@/lib/db/dbStatus';

import { DbInterruptedScreen } from './DbInterruptedScreen';

afterEach(() => {
  useDbStatus.getState().reset();
});

describe('DbInterruptedScreen', () => {
  it('names the reason and offers a reload', () => {
    render(<DbInterruptedScreen reason="versionchange" />);
    const screenEl = screen.getByTestId('db-interrupted-screen');
    expect(screenEl).toHaveAttribute('role', 'alert');
    expect(screenEl).toHaveTextContent(i18n.t('db.interrupted.versionchange'));
    expect(screen.getByTestId('db-interrupted-reload')).toBeInTheDocument();
  });

  it('distinguishes `blocked` from `versionchange`', () => {
    render(<DbInterruptedScreen reason="blocked" />);
    expect(screen.getByTestId('db-interrupted-screen')).toHaveTextContent(
      i18n.t('db.interrupted.blocked'),
    );
  });
});

describe('dbStatus store', () => {
  it('keeps the FIRST reason', () => {
    // The second event is a consequence of the first; rewriting the message
    // under the user mid-read helps nobody.
    dbInterrupted('versionchange');
    dbInterrupted('blocked');
    expect(useDbStatus.getState().interruption).toBe('versionchange');
  });

  it('starts clean', () => {
    expect(useDbStatus.getState().interruption).toBeNull();
  });
});

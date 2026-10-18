import 'fake-indexeddb/auto';

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/lib/i18n/i18n';
import i18n from '@/lib/i18n/i18n';
import { dbInterrupted, useDbStatus } from '@/lib/db/dbStatus';

import { App } from './App';

/** Spec 009 — the app root swaps in the explanation when the DB would not open. */

afterEach(() => {
  useDbStatus.getState().reset();
});

describe('App — database that would not open', () => {
  it('shows the DB-interrupted screen instead of the routes', async () => {
    dbInterrupted('openFailed');
    render(<App />);
    expect(await screen.findByTestId('db-interrupted-screen')).toHaveTextContent(
      i18n.t('db.interrupted.openFailed'),
    );
    expect(screen.queryByTestId('calendar-header')).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/lib/i18n/i18n';
import i18n from '@/lib/i18n/i18n';

import type { NotificationStatus } from '@/features/notifications/notificationSupport';

const h = vi.hoisted(() => ({
  status: 'off' as NotificationStatus,
  enable: vi.fn(),
  disable: vi.fn(),
  sendTest: vi.fn(),
  calendarConnected: false,
}));

vi.mock('@/features/notifications/useNotificationStatus', () => ({
  useNotificationStatus: () => ({
    status: h.status,
    enable: h.enable,
    disable: h.disable,
    sendTest: h.sendTest,
  }),
}));
vi.mock('./useCalendarConnection', () => ({
  useCalendarConnection: () => ({ isConnected: h.calendarConnected }),
}));

import { NotificationsSection } from './NotificationsSection';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.status = 'off';
  h.calendarConnected = false;
  h.enable.mockReset().mockResolvedValue(undefined);
  h.disable.mockReset();
  h.sendTest.mockReset().mockResolvedValue(undefined);
});

describe('NotificationsSection', () => {
  it('off: offers «Enable notifications», which requests via the hook', async () => {
    const user = userEvent.setup();
    render(<NotificationsSection />);
    expect(screen.getByTestId('settings-notifications-status')).toHaveTextContent(
      i18n.t('settings.notifications.status.off'),
    );
    await user.click(screen.getByTestId('settings-notifications-enable'));
    expect(h.enable).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('settings-notifications-test')).not.toBeInTheDocument();
  });

  it('on: offers the test notification and turning off', async () => {
    h.status = 'on';
    const user = userEvent.setup();
    render(<NotificationsSection />);
    expect(screen.queryByTestId('settings-notifications-enable')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('settings-notifications-test'));
    expect(h.sendTest).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('settings-notifications-disable'));
    expect(h.disable).toHaveBeenCalledTimes(1);
  });

  it('blocked: explains how to allow them and offers no buttons', () => {
    h.status = 'blocked';
    render(<NotificationsSection />);
    expect(screen.getByTestId('settings-notifications-blocked-hint')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('unsupported: says so and offers no buttons', () => {
    h.status = 'unsupported';
    render(<NotificationsSection />);
    expect(screen.getByTestId('settings-notifications-status')).toHaveTextContent(
      i18n.t('settings.notifications.status.unsupported'),
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['off', 'on', 'blocked', 'unsupported'] as const)(
    'always explains the closed-app limit (%s)',
    (status) => {
      h.status = status;
      render(<NotificationsSection />);
      expect(screen.getByTestId('settings-notifications-limit')).toHaveTextContent(
        i18n.t('settings.notifications.limitNoCalendar'),
      );
    },
  );

  it('names Google Calendar as the closed-app source when it is connected', () => {
    h.calendarConnected = true;
    render(<NotificationsSection />);
    expect(screen.getByTestId('settings-notifications-limit')).toHaveTextContent(
      i18n.t('settings.notifications.limitCalendar'),
    );
  });
});

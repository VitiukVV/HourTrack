import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import i18n from '@/lib/i18n/i18n';
import { installNotificationEnv, type FakeNotificationEnv } from '@/test-utils/notificationEnv';

import {
  closeStaleReminderNotifications,
  showReminderNotification,
  showTestNotification,
} from './showReminderNotification';

let env: FakeNotificationEnv;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  env = installNotificationEnv({ permission: 'granted' });
});

afterEach(() => {
  env.restore();
});

describe('showReminderNotification', () => {
  it('posts one notification tagged by reminder id, with the text and a Done action', async () => {
    expect(await showReminderNotification({ id: 'r1', text: 'Call Mary' })).toBe(true);

    expect(env.registration.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = env.registration.showNotification.mock.calls[0]!;
    expect(title).toBe(i18n.t('reminders.notification.title'));
    expect(options).toMatchObject({
      body: 'Call Mary',
      tag: 'reminder:r1',
      data: { reminderId: 'r1' },
      actions: [{ action: 'done', title: 'Done' }],
    });
  });

  it('uses the current language', async () => {
    await i18n.changeLanguage('uk');
    await showReminderNotification({ id: 'r1', text: 'x' });
    const [, options] = env.registration.showNotification.mock.calls[0]!;
    expect((options as { actions: { title: string }[] }).actions[0]!.title).toBe(
      i18n.t('reminders.done'),
    );
    expect(i18n.t('reminders.done')).not.toBe('Done');
  });

  it('returns false without a service worker registration', async () => {
    env.restore();
    env = installNotificationEnv({ permission: 'granted', withRegistration: false });
    expect(await showReminderNotification({ id: 'r1', text: 'x' })).toBe(false);
  });
});

describe('showTestNotification', () => {
  it('posts a test notification that is not tied to a reminder', async () => {
    expect(await showTestNotification()).toBe(true);
    const [, options] = env.registration.showNotification.mock.calls[0]!;
    expect(options).toMatchObject({ tag: 'test' });
    expect((options as { data?: unknown }).data).toBeUndefined();
  });
});

describe('closeStaleReminderNotifications', () => {
  it('closes only reminder notifications whose reminder is no longer open', async () => {
    await showReminderNotification({ id: 'open', text: 'a' });
    await showReminderNotification({ id: 'gone', text: 'b' });
    await showTestNotification();

    await closeStaleReminderNotifications(new Set(['open']));

    expect(env.shown.map((n) => n.tag)).toEqual(['reminder:open', 'test']);
  });

  it('is a no-op without a registration', async () => {
    env.restore();
    env = installNotificationEnv({ withRegistration: false });
    await expect(closeStaleReminderNotifications(new Set())).resolves.toBeUndefined();
  });
});

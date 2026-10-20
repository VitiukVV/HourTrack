import { vi } from 'vitest';

/** A shown notification as `registration.getNotifications()` hands it back. */
export interface FakeShownNotification {
  title: string;
  tag: string;
  data: unknown;
  close: ReturnType<typeof vi.fn>;
}

export interface FakeNotificationEnv {
  registration: {
    showNotification: ReturnType<typeof vi.fn>;
    getNotifications: ReturnType<typeof vi.fn>;
  };
  shown: FakeShownNotification[];
  requestPermission: ReturnType<typeof vi.fn>;
  setPermission(permission: NotificationPermission): void;
  restore(): void;
}

interface FakeEnvOptions {
  permission?: NotificationPermission;
  /** `false` mimics dev, where the service worker is never registered. */
  withRegistration?: boolean;
}

/**
 * Installs a fake `Notification` + `navigator.serviceWorker` pair (happy-dom
 * ships neither). `showNotification` records into `shown`, so
 * `getNotifications` returns what was posted, like the real registration.
 */
export function installNotificationEnv(options: FakeEnvOptions = {}): FakeNotificationEnv {
  let permission: NotificationPermission = options.permission ?? 'default';
  const shown: FakeShownNotification[] = [];

  const requestPermission = vi.fn(() => Promise.resolve(permission));
  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
    requestPermission,
  });

  const registration = {
    showNotification: vi.fn((title: string, opts: NotificationOptions = {}) => {
      const entry: FakeShownNotification = {
        title,
        tag: opts.tag ?? '',
        data: opts.data,
        close: vi.fn(() => {
          const at = shown.indexOf(entry);
          if (at >= 0) shown.splice(at, 1);
        }),
      };
      shown.push(entry);
      return Promise.resolve();
    }),
    getNotifications: vi.fn(() => Promise.resolve([...shown])),
  };

  const withRegistration = options.withRegistration ?? true;
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn(() => Promise.resolve(withRegistration ? registration : undefined)),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });

  return {
    registration,
    shown,
    requestPermission,
    setPermission(next) {
      permission = next;
    },
    restore() {
      vi.unstubAllGlobals();
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    },
  };
}

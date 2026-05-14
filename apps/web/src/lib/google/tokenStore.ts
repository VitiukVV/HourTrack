import type { AuthTokensRow, HourTrackDB } from '@/lib/db/schema';
import { db as singletonDb } from '@/lib/db';

/**
 * Token store backed by IndexedDB (Dexie `authTokens` v2 store).
 *
 * Public shape (`AuthTokens`) excludes the `key` discriminator that the
 * Dexie row carries; the store strips it on read and adds it on write.
 *
 * Subscribers receive the current snapshot synchronously on subscribe AND
 * on every change. Used by `AuthProvider` to drive the React `status` state
 * machine without polling Dexie.
 *
 * Refresh tokens (when issued by Google) live here and ONLY here — never
 * localStorage. The MUST per PROJECT_PLAN.md section 9.1.
 */

export interface AuthTokens {
  accessToken: string;
  /** Epoch ms when `accessToken` expires. */
  accessTokenExpiresAt: number;
  refreshToken: string | null;
  idToken: string | null;
  /** Space-separated granted scopes echoed by Google. */
  scope: string;
  /** Cached user profile fields. `null` until `getUserInfo` runs. */
  email: string | null;
  name: string | null;
  picture: string | null;
}

const KEY = 'current' as const;

type Listener = (next: AuthTokens | null) => void;
const listeners = new Set<Listener>();

/** Notify all subscribers with the current snapshot. */
function emit(next: AuthTokens | null): void {
  for (const l of listeners) {
    try {
      l(next);
    } catch {
      // Listeners must not throw; swallow so one bad subscriber doesn't
      // poison the others.
    }
  }
}

function rowToTokens(row: AuthTokensRow | undefined): AuthTokens | null {
  if (!row) return null;
  const { key: _key, ...rest } = row;
  return rest;
}

/**
 * Read the current tokens, or `null` when no row exists yet.
 *
 * Takes the Dexie DB instance as the first arg (test-friendly pattern from
 * S02). Defaults to the singleton when omitted.
 */
export async function getTokens(db: HourTrackDB = singletonDb): Promise<AuthTokens | null> {
  const row = await db.authTokens.get(KEY);
  return rowToTokens(row);
}

/**
 * Persist a full or partial tokens patch. Missing fields are filled with
 * `null` (refresh/id token) or carried forward from the existing row.
 *
 * Emits to all subscribers AFTER the Dexie write resolves.
 */
export async function setTokens(
  patch: Partial<AuthTokens> & Pick<AuthTokens, 'accessToken' | 'accessTokenExpiresAt' | 'scope'>,
  db: HourTrackDB = singletonDb,
): Promise<AuthTokens> {
  const existing = await db.authTokens.get(KEY);
  const base: AuthTokens = existing
    ? rowToTokens(existing)!
    : {
        accessToken: '',
        accessTokenExpiresAt: 0,
        refreshToken: null,
        idToken: null,
        scope: '',
        email: null,
        name: null,
        picture: null,
      };
  const next: AuthTokens = {
    ...base,
    ...patch,
  };
  const row: AuthTokensRow = { key: KEY, ...next };
  await db.authTokens.put(row);
  emit(next);
  return next;
}

/**
 * Update the cached user profile fields (name/email/picture). Returns the
 * new merged tokens or `null` if no tokens row exists.
 */
export async function setUserProfile(
  profile: { email: string | null; name: string | null; picture: string | null },
  db: HourTrackDB = singletonDb,
): Promise<AuthTokens | null> {
  const existing = await db.authTokens.get(KEY);
  if (!existing) return null;
  const next: AuthTokensRow = {
    ...existing,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
  };
  await db.authTokens.put(next);
  const tokens = rowToTokens(next);
  emit(tokens);
  return tokens;
}

/**
 * Wipe the tokens row. Emits `null` to subscribers afterwards.
 */
export async function clearTokens(db: HourTrackDB = singletonDb): Promise<void> {
  await db.authTokens.delete(KEY);
  emit(null);
}

/**
 * Subscribe to token-store updates. Returns the unsubscribe function.
 *
 * The listener is invoked AFTER subscribe with the current snapshot, so
 * consumers don't need a separate initial read. Useful for the
 * `AuthProvider` effect.
 */
export function subscribe(listener: Listener, db: HourTrackDB = singletonDb): () => void {
  listeners.add(listener);
  // Fire-and-forget initial snapshot; if the read fails the listener simply
  // won't see an initial value (consumer can call `getTokens` directly).
  void getTokens(db)
    .then(listener)
    .catch(() => {
      /* swallow -- listener sees no initial value */
    });
  return () => {
    listeners.delete(listener);
  };
}

import { CalendarAuthError } from './calendar';
import { DriveAuthError } from './drive';
import { forceRenewAccessToken, getFreshAccessToken } from './tokenRefresh';

/** No stored session: there is nobody to make the call as. */
export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'NotSignedInError';
  }
}

/**
 * The call failed because there is no usable sign-in: signed out, or Google
 * still said 401 after `withFreshToken` renewed once. The user can fix it by
 * signing in again — show that, not the raw API text.
 */
export function isSignInLost(err: unknown): boolean {
  return (
    err instanceof NotSignedInError ||
    err instanceof DriveAuthError ||
    err instanceof CalendarAuthError
  );
}

/** The two token functions; injectable for tests. */
export interface TokenFunctions {
  getFresh: () => Promise<string | null>;
  forceRenew: () => Promise<string | null>;
}

const defaultTokens: TokenFunctions = {
  getFresh: () => getFreshAccessToken(),
  forceRenew: () => forceRenewAccessToken(),
};

/**
 * Run a one-off Google call with a token that is valid NOW — not the one React
 * context captured at render, which is stale after the app sat idle. A 401
 * renews the token and repeats the call once; if renewal yields nothing new the
 * original error surfaces. Signed out → `NotSignedInError`.
 */
export async function withFreshToken<T>(
  call: (accessToken: string) => Promise<T>,
  tokens: TokenFunctions = defaultTokens,
): Promise<T> {
  const token = await tokens.getFresh();
  if (!token) throw new NotSignedInError();
  try {
    return await call(token);
  } catch (err) {
    if (!(err instanceof DriveAuthError || err instanceof CalendarAuthError)) throw err;
    const renewed = await tokens.forceRenew();
    if (!renewed || renewed === token) throw err;
    return call(renewed);
  }
}

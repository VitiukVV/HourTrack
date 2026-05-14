import { createContext, useContext } from 'react';

import type { AuthTokens } from '@/lib/google/tokenStore';

/**
 * Auth context types + hook. Extracted from `AuthProvider.tsx` so the
 * provider module stays component-only (Fast Refresh rule).
 */

export type AuthStatus = 'loading' | 'authed' | 'anonymous';

export interface AuthUser {
  email: string;
  name: string | null;
  picture: string | null;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  tokens: AuthTokens | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Consume the auth context. Throws if used outside `<AuthProvider>` — that
 * mistake is a developer error and silently returning a stub would hide it.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() called outside of <AuthProvider>');
  }
  return ctx;
}

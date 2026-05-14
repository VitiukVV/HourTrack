/**
 * PKCE (Proof Key for Code Exchange) helpers per RFC 7636.
 *
 *   code_verifier  = high-entropy random string (we use 32 random bytes,
 *                    base64url-encoded — 43 chars after stripping `=` padding).
 *   code_challenge = BASE64URL(SHA-256(code_verifier))
 *   method         = S256
 *
 * The verifier is generated client-side, stored briefly in sessionStorage
 * during the auth-code redirect, and then exchanged with Google's token
 * endpoint to prove possession of the verifier without ever transmitting it
 * directly.
 *
 * Implementation notes:
 *   - We use the Web Crypto API (`crypto.getRandomValues` and
 *     `crypto.subtle.digest`). Both are available in all browsers targeted by
 *     the PWA.
 *   - The base64url encoding strips `=` padding and replaces `+/` with `-_`.
 *   - Verifier length per spec is 43..128 chars. 32 random bytes -> 43 chars
 *     after base64url-no-pad, the minimum allowed.
 *
 * Test vectors used in `pkce.test.ts`:
 *   - RFC 7636 Appendix B: verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`
 *     -> challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`.
 */

/**
 * Encode a `Uint8Array` to base64url (no padding, `-_` alphabet).
 *
 * Exported (not just internal) because `gisClient` re-uses it when packaging
 * the OAuth code response into a form-urlencoded POST body for the token
 * exchange.
 */
export function toBase64Url(bytes: Uint8Array): string {
  // Convert byte array -> binary string -> standard base64 -> url-safe base64.
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a high-entropy code verifier per RFC 7636.
 *
 * Returns a 43-character base64url-encoded string derived from 32 random
 * bytes. The result is suitable for `code_verifier` in the PKCE flow.
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Derive the code challenge for a given verifier per RFC 7636: the base64url
 * encoding of the SHA-256 hash of the verifier's ASCII bytes.
 *
 * `code_challenge_method` MUST be `'S256'` when this function is used.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return toBase64Url(new Uint8Array(hashBuffer));
}

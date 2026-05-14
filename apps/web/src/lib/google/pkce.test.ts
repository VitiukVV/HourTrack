import { describe, expect, it } from 'vitest';

import { generateCodeChallenge, generateCodeVerifier, toBase64Url } from './pkce';

/**
 * RFC 7636 reference test vector (Appendix B):
 *   verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
 *   challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
 *   method    = S256
 *
 * This is the canonical conformance vector — if our `generateCodeChallenge`
 * doesn't reproduce it, the implementation is wrong and Google will reject
 * the exchange.
 */
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('toBase64Url', () => {
  it('encodes empty bytes to empty string', () => {
    expect(toBase64Url(new Uint8Array(0))).toBe('');
  });

  it('uses url-safe alphabet (no +, /, =)', () => {
    // 0xfb, 0xff produce '+' and '/' in standard base64 -- verify we got '-_'.
    const out = toBase64Url(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(out).not.toContain('+');
    expect(out).not.toContain('/');
    expect(out).not.toContain('=');
  });

  it('round-trips ASCII bytes back through atob', () => {
    const original = 'hello-world';
    const bytes = new TextEncoder().encode(original);
    const encoded = toBase64Url(bytes);
    // Re-pad and reverse url-safe substitutions for decode.
    const padded =
      encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4);
    expect(atob(padded)).toBe(original);
  });
});

describe('generateCodeChallenge', () => {
  it('matches the RFC 7636 reference vector', async () => {
    const challenge = await generateCodeChallenge(RFC_VERIFIER);
    expect(challenge).toBe(RFC_CHALLENGE);
  });

  it('produces a 43-character base64url string for any non-empty verifier', async () => {
    const challenge = await generateCodeChallenge('any-verifier-value');
    // SHA-256 -> 32 bytes -> base64url no-padding -> 43 chars.
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic for the same verifier', async () => {
    const a = await generateCodeChallenge('same-input');
    const b = await generateCodeChallenge('same-input');
    expect(a).toBe(b);
  });

  it('produces different challenges for different verifiers', async () => {
    const a = await generateCodeChallenge('verifier-A');
    const b = await generateCodeChallenge('verifier-B');
    expect(a).not.toBe(b);
  });
});

describe('generateCodeVerifier', () => {
  it('returns a 43-character base64url string', () => {
    const v = generateCodeVerifier();
    expect(v).toHaveLength(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a different value on each call (high entropy)', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    const v3 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
    expect(v2).not.toBe(v3);
    expect(v1).not.toBe(v3);
  });

  it('end-to-end: verifier -> challenge produces the RFC-required shape', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // Verifier and its challenge must NEVER be equal -- if they are, SHA-256
    // never fired and we have a critical regression.
    expect(challenge).not.toBe(verifier);
  });
});

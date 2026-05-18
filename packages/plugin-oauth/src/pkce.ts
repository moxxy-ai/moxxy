import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate a PKCE code verifier per RFC 7636 §4.1.
 * Spec range: 43–128 chars from the unreserved set [A-Z a-z 0-9 - . _ ~].
 * We use 96 bytes of entropy → 128 base64url chars (full length).
 */
export function generateCodeVerifier(): string {
  return base64urlEncode(randomBytes(96));
}

/**
 * RFC 7636 §4.2 — SHA-256(verifier) then base64url-encode. The
 * challenge_method is implied: callers MUST send `code_challenge_method=S256`
 * to the authorization endpoint when using this helper.
 */
export function computeCodeChallenge(codeVerifier: string): string {
  return base64urlEncode(createHash('sha256').update(codeVerifier).digest());
}

/**
 * Opaque CSRF token included in the `state` query param. The callback
 * server verifies that the returned state matches what we sent, so a
 * cross-site forgery can't redirect the user back into our local
 * server with attacker-controlled code.
 */
export function generateState(): string {
  return base64urlEncode(randomBytes(24));
}

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

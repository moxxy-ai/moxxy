/**
 * Bearer-token handshake for the WebSocket bridge. Reuses the SDK's
 * constant-time {@link bearerTokenMatches} (same comparator the HTTP/web
 * channels use) so a token guess can't be timed. Two presentations are
 * accepted because a browser/Expo `WebSocket` can't always set request headers:
 *   1. `Authorization: Bearer <token>` (preferred), and
 *   2. a `?t=<token>` query parameter (fallback).
 */

import type { IncomingMessage } from 'node:http';
import { bearerGuard } from '@moxxy/sdk';

const BEARER = 'Bearer ';

export function checkWsAuth(req: IncomingMessage, expected: string): boolean {
  // Shared pre-connection bearer handler — empty `expected` always denies.
  const guard = bearerGuard(expected);

  const auth = req.headers.authorization;
  if (auth && auth.startsWith(BEARER) && guard(auth.slice(BEARER.length))) return true;

  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (guard(url.searchParams.get('t'))) return true;
  } catch {
    // Malformed request URL — treat as unauthenticated.
  }
  return false;
}

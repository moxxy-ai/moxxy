import { hostname, userInfo } from 'node:os';
import type { Principal } from './principal.js';

/**
 * The local OS account, as a {@link Principal}.
 *
 * This is the FLOOR identity: it is what the TUI and other local surfaces
 * attribute to when no stronger issuer (a channel token, an OIDC assertion) is
 * available. Its trust is exactly the trust of local account separation, which
 * is why {@link Principal.issuer} says `os` rather than pretending to more.
 *
 * The id is `user@host` because a bare username is ambiguous the moment
 * transcripts from several machines reach one audit sink.
 */
export function resolveOsPrincipal(): Principal {
  const user = safeUsername();
  const host = safeHostname();
  return {
    id: host ? `${user}@${host}` : user,
    kind: 'human',
    issuer: 'os',
    displayName: user,
  };
}

/**
 * `userInfo()` throws when the uid has no passwd entry, which happens in
 * distroless containers and some CI images. An unattributed session is worse
 * than a coarse one, so fall back rather than fail.
 */
function safeUsername(): string {
  try {
    const name = userInfo().username.trim();
    if (name.length > 0) return name;
  } catch {
    /* fall through */
  }
  const fromEnv = (process.env.USER ?? process.env.USERNAME ?? '').trim();
  return fromEnv.length > 0 ? fromEnv : 'unknown';
}

function safeHostname(): string {
  try {
    return hostname().trim();
  } catch {
    return '';
  }
}

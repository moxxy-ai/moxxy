import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

/**
 * Shared SSRF guard for every model-drivable navigation/fetch path in this
 * plugin: `web_fetch` (initial URL + every redirect hop), `browser_session`'s
 * goto (parent side), the sidecar's goto dispatch (child-process side), and
 * the sidecar's in-page navigation interceptor.
 *
 * Blocks non-HTTP(S) schemes, loopback (incl. `localhost`/`*.localhost`),
 * 0.0.0.0/8, RFC-1918 private ranges, link-local 169.254/16 (incl. the
 * 169.254.169.254 cloud metadata endpoint), CGNAT 100.64/10, multicast/
 * reserved, and IPv6 loopback/link-local/unique-local (+ v4-mapped). Hostnames
 * are resolved so an internal DNS name (or rebinding) can't smuggle a private
 * target past the literal-IP checks.
 *
 * NOTE: deliberately NO `@moxxy/sdk` import. The Playwright sidecar — a
 * separate child process whose bundle must stay free of non-builtin deps —
 * imports this module too. Parent-side callers wrap `SsrfBlockedError` into
 * `MoxxyError` themselves.
 */

/** Thrown for every guard rejection (bad scheme, private/loopback target, unparseable URL). */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export type DnsResolver = (host: string) => Promise<ReadonlyArray<string>>;
const defaultResolver: DnsResolver = async (host) =>
  (await dnsLookup(host, { all: true })).map((a) => a.address);
let resolver: DnsResolver = defaultResolver;

/** Test seam: override DNS resolution so SSRF tests stay hermetic. Pass null to reset. */
export function setSsrfDnsResolver(fn: DnsResolver | null): void {
  resolver = fn ?? defaultResolver;
}

/**
 * Local presence guard for impossible-by-construction absences (a `String.split`
 * first element, a matched regex's capture groups) that TS's index/capture types
 * widen to `T | undefined`. This module deliberately imports NO non-builtin deps
 * (see header) — the Playwright sidecar bundles it — so we cannot use
 * `assertDefined` from `@moxxy/sdk`.
 */
function present<T>(value: T | undefined, why: string): T {
  if (value === undefined) throw new Error(`ssrf-guard: unreachable — ${why}`);
  return value;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  // strip zone id
  const addr = present(
    ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0],
    'String.split always yields at least one element',
  );
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  if (addr.startsWith('fe80')) return true; // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique-local fc00::/7
  // Embedded-v4 forms: re-run the v4 policy against the embedded address.
  // The WHATWG URL parser canonicalizes [::ffff:127.0.0.1] to its HEX form
  // ::ffff:7f00:1, so the dotted regex alone NEVER matches a real URL — we must
  // also reconstruct the dotted quad from the trailing hex groups. Covers
  // v4-mapped (::ffff:a.b.c.d / ::ffff:0:a.b.c.d), v4-compatible (::a.b.c.d),
  // and NAT64 (64:ff9b::/96) — any of which could otherwise smuggle a private
  // v4 target (loopback / 169.254.169.254 metadata) past the guard.
  const embeddedV4 = extractEmbeddedV4(addr);
  if (embeddedV4) return isBlockedIpv4(embeddedV4);
  return false;
}

/**
 * Pull the embedded IPv4 out of any v4-mapped / v4-compatible / NAT64 IPv6
 * address, returning it as a dotted quad, or null if there is none. Handles
 * both the dotted spelling (`::ffff:127.0.0.1`) and — critically — the HEX
 * spelling the URL parser actually produces (`::ffff:7f00:1`).
 */
function extractEmbeddedV4(addr: string): string | null {
  // Dotted spelling: ::ffff:a.b.c.d, ::ffff:0:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d
  const dotted = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted && (addr.startsWith('::ffff:') || addr.startsWith('::') || addr.startsWith('64:ff9b:'))) {
    return present(dotted[1], 'dotted regex matched and has a capture group');
  }
  // Hex spelling: the embedded v4 lives in the two trailing 16-bit groups.
  const hex = addr.match(/^(?:::ffff:|::ffff:0:|64:ff9b:(?::|.*:)|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(present(hex[1], 'hex regex matched and has capture group 1'), 16);
    const lo = parseInt(present(hex[2], 'hex regex matched and has capture group 2'), 16);
    if (Number.isInteger(hi) && Number.isInteger(lo) && hi <= 0xffff && lo <= 0xffff) {
      return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    }
  }
  return null;
}

export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // not a parseable IP → block
}

/**
 * Reject `raw` unless it is an http(s) URL whose host is (and resolves to)
 * a public address. `label` prefixes the error message so each caller's
 * rejections stay attributable (e.g. "web_fetch", "browser_session").
 *
 * Returns the vetted resolved addresses so callers can PIN the subsequent
 * connection to exactly what was checked (closing the DNS-rebinding TOCTOU
 * where the guard resolves one answer and the fetch independently resolves
 * another — see web-fetch's pinned undici dispatcher). Returns `null` when
 * there is nothing to pin: the host is already an IP literal (vetted above,
 * no DNS involved) or resolution failed (fail-open — a name the guard can't
 * resolve, the fetch's identical system resolver can't reach either).
 */
export async function assertPublicUrl(
  raw: string,
  label = 'request',
  opts: { failClosed?: boolean } = {},
): Promise<ReadonlyArray<string> | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsrfBlockedError(`${label}: invalid URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfBlockedError(`${label}: refusing non-HTTP(S) scheme "${u.protocol}"`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfBlockedError(`${label}: refusing to fetch loopback host "${host}"`);
  }
  if (isIP(host)) {
    if (isBlockedIp(host))
      throw new SsrfBlockedError(`${label}: refusing private/loopback address "${host}"`);
    return null;
  }
  // Resolve the name and block if it maps to a private range (internal name or
  // DNS rebinding). web_fetch fails OPEN on resolution error (its identical
  // system resolver + pinned dispatcher mean an unresolvable name is no vector),
  // but the BROWSER paths hand the URL to Chromium's own resolver/cache — which
  // may resolve a name node:dns just failed on — so they pass `failClosed` to
  // SOFT-BLOCK instead of allowing an un-vetted name through to the browser.
  let addrs: ReadonlyArray<string>;
  try {
    addrs = await resolver(host);
  } catch {
    if (opts.failClosed) {
      throw new SsrfBlockedError(
        `${label}: refusing host "${host}" — DNS resolution failed (cannot vet against private ranges)`,
      );
    }
    return null;
  }
  for (const addr of addrs) {
    if (isBlockedIp(addr)) {
      throw new SsrfBlockedError(
        `${label}: host "${host}" resolves to a private/loopback address (${addr})`,
      );
    }
  }
  return addrs;
}

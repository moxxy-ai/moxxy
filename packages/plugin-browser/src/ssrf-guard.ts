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
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!; // strip zone id
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  if (addr.startsWith('fe80')) return true; // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique-local fc00::/7
  const v4mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isBlockedIpv4(v4mapped[1]!);
  return false;
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
 */
export async function assertPublicUrl(raw: string, label = 'request'): Promise<void> {
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
    return;
  }
  // Resolve the name and block if it maps to a private range (internal name or
  // DNS rebinding). Fail OPEN on resolution error: a name we can't resolve here
  // the subsequent fetch can't reach either, so it's no SSRF vector.
  let addrs: ReadonlyArray<string>;
  try {
    addrs = await resolver(host);
  } catch {
    return;
  }
  for (const addr of addrs) {
    if (isBlockedIp(addr)) {
      throw new SsrfBlockedError(
        `${label}: host "${host}" resolves to a private/loopback address (${addr})`,
      );
    }
  }
}

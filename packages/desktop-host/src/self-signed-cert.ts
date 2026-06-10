/**
 * Generate (and cache) a self-signed TLS certificate for the desktop app's
 * loopback HTTPS server, using ONLY `node:crypto` — no third-party cert
 * library, no shelling out to OpenSSL (which a packaged Electron app can't
 * assume is present), and no private key checked into the repo or bundle.
 *
 * WHY a cert at all: a Clerk PRODUCTION key (`pk_live_`) is domain-locked —
 * clerk-js's Frontend API rejects any `Origin` that isn't `moxxy.ai` or a
 * subdomain of it. A loopback IP origin (`http://127.0.0.1:<port>`) can never
 * satisfy that. So the packaged renderer is served at
 * `https://desktop.moxxy.ai:<port>`, where `desktop.moxxy.ai` is a public DNS
 * A-record → 127.0.0.1 (owner-provisioned). HTTPS on a real hostname needs a
 * cert, so we mint a self-signed one for exactly that host.
 *
 * WHY self-signed is fine here: the server only ever binds loopback and only
 * ever serves our own `dist/`. The cert is NOT trusted system-wide — the
 * Electron main process scope-trusts it for exactly this host + the loopback
 * ports AND only when its fingerprint matches the one minted here (see the
 * `certificate-error` handler in the app). So a self-signed cert carries no
 * weaker guarantee than the loopback bind itself already does.
 *
 * WHY generate-at-first-run-and-cache (not bundle a fixed cert+key): bundling
 * a fixed private key would ship a secret in the app image. Generating one on
 * first run and caching it under `userData` keeps the key off-disk-until-needed
 * and unique per install, and the scoped fingerprint trust means there's no
 * dependency on a stable public key.
 *
 * Kept free of any `electron` import so it stays unit-testable in plain Node.
 */

import { promises as fsp } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

/** The single public hostname the packaged renderer is served under. It is a
 *  subdomain of `moxxy.ai`, so a Clerk production key accepts its origin; the
 *  owner provisions a DNS A-record `desktop.moxxy.ai → 127.0.0.1` so it only
 *  ever resolves to loopback (never externally reachable). Shared with the
 *  main process (host allow-list + scoped cert trust). */
export const DESKTOP_APP_HOST = 'desktop.moxxy.ai';

export interface SelfSignedCert {
  /** PEM-encoded certificate (the leaf, self-signed). */
  readonly cert: string;
  /** PEM-encoded PKCS#8 private key. */
  readonly key: string;
  /** SHA-256 fingerprint, colon-separated uppercase hex (matches
   *  `X509Certificate.fingerprint256` / Electron's
   *  `request.certificate.fingerprint` after the `sha256/` prefix). */
  readonly fingerprint256: string;
}

// ---- Minimal DER (ASN.1) encoders ----------------------------------------
// Just enough to assemble an X.509 v3 certificate. Each helper returns a
// complete TLV (tag-length-value) buffer.

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function seq(...items: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(items));
}

function setOf(...items: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(items));
}

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const body: number[] = [40 * parts[0]! + parts[1]!];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]!;
    const stack: number[] = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    body.push(...stack);
  }
  return tlv(0x06, Buffer.from(body));
}

function utf8(s: string): Buffer {
  return tlv(0x0c, Buffer.from(s, 'utf8'));
}

/** DER INTEGER from a big-endian magnitude; prepends 0x00 if the high bit is
 *  set so the value stays positive. */
function integer(magnitude: Buffer): Buffer {
  const buf = magnitude[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), magnitude]) : magnitude;
  return tlv(0x02, buf);
}

function bitString(buf: Buffer): Buffer {
  // 0 unused bits.
  return tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
}

function utcTime(d: Date): Buffer {
  // YYMMDDHHMMSSZ — valid for years 1950–2049, which covers our 10-year cert.
  const s = d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

/** Context-specific [n] tag (constructed). */
function context(n: number, content: Buffer): Buffer {
  return tlv(0xa0 | n, content);
}

/**
 * Mint a fresh self-signed RSA-2048 / SHA-256 certificate for
 * {@link DESKTOP_APP_HOST}, valid for 10 years, with a Subject Alternative
 * Name set to the host (modern TLS stacks ignore the CN and require the SAN).
 */
export function generateSelfSignedCert(host: string = DESKTOP_APP_HOST): SelfSignedCert {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  // sha256WithRSAEncryption, params = NULL.
  const sigAlg = seq(oid('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0)));

  // Distinguished name: CN=<host>. Issuer == Subject (self-signed).
  const name = seq(setOf(seq(oid('2.5.4.3'), utf8(host))));

  // subjectAltName = DNS:<host>. [2] dNSName is IA5String-as-implicit (tag 0x82).
  const sanValue = seq(tlv(0x82, Buffer.from(host, 'ascii')));
  const sanExt = seq(oid('2.5.29.17'), tlv(0x04, sanValue));
  const extensions = context(3, seq(sanExt));

  const notBefore = new Date(Date.now() - 3600_000); // 1h skew tolerance
  const notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600_000);

  const tbs = seq(
    context(0, integer(Buffer.from([2]))), // version v3 (encoded as 2)
    integer(crypto.randomBytes(8)), // serial number
    sigAlg,
    name, // issuer
    seq(utcTime(notBefore), utcTime(notAfter)),
    name, // subject
    Buffer.from(spki),
    extensions,
  );

  const signature = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, sigAlg, bitString(signature));

  const cert =
    '-----BEGIN CERTIFICATE-----\n' +
    (der.toString('base64').match(/.{1,64}/g) ?? []).join('\n') +
    '\n-----END CERTIFICATE-----\n';
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  return { cert, key, fingerprint256: new crypto.X509Certificate(cert).fingerprint256 };
}

/**
 * Load the cached self-signed cert for {@link DESKTOP_APP_HOST} from `dir`, or
 * mint + persist a fresh one if absent / unreadable / mismatched-host /
 * expiring soon. The key is written 0600. `dir` is typically the app's
 * `userData` (writable, per-install).
 */
export async function loadOrCreateSelfSignedCert(
  dir: string,
  host: string = DESKTOP_APP_HOST,
): Promise<SelfSignedCert> {
  const certPath = path.join(dir, 'loopback-cert.pem');
  const keyPath = path.join(dir, 'loopback-key.pem');
  try {
    const [cert, key] = await Promise.all([
      fsp.readFile(certPath, 'utf8'),
      fsp.readFile(keyPath, 'utf8'),
    ]);
    const x = new crypto.X509Certificate(cert);
    // Re-mint if it's for a different host or within 30 days of expiry, so a
    // stale cache can't quietly break the handshake.
    const expiresSoon = new Date(x.validTo).getTime() - Date.now() < 30 * 24 * 3600_000;
    const hostMatches = x.subjectAltName?.includes(`DNS:${host}`) ?? false;
    if (hostMatches && !expiresSoon) {
      return { cert, key, fingerprint256: x.fingerprint256 };
    }
  } catch {
    /* missing / unreadable / unparseable — fall through and mint a fresh one */
  }

  const fresh = generateSelfSignedCert(host);
  await fsp.mkdir(dir, { recursive: true });
  await Promise.all([
    fsp.writeFile(certPath, fresh.cert, { mode: 0o600 }),
    fsp.writeFile(keyPath, fresh.key, { mode: 0o600 }),
  ]);
  return fresh;
}

/**
 * Normalise a SHA-256 fingerprint to lowercase colon-free hex so the two
 * encodings we encounter compare equal:
 *   - `X509Certificate.fingerprint256` → colon-separated uppercase hex
 *     (`AB:CD:…`), what we mint;
 *   - Electron's `certificate.fingerprint` → `sha256/<base64>` of the raw
 *     digest, what the `certificate-error` event hands us.
 * Returns null if the input isn't a recognisable SHA-256 fingerprint (so an
 * unparseable value never accidentally matches).
 */
function normalizeFingerprint(fp: string | undefined | null): string | null {
  if (!fp) return null;
  const s = fp.trim();
  const b64 = /^sha256\/(.+)$/i.exec(s);
  if (b64) {
    try {
      const hex = Buffer.from(b64[1]!, 'base64').toString('hex');
      return hex.length === 64 ? hex : null;
    } catch {
      return null;
    }
  }
  const hex = s.replace(/:/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function sameFingerprint(a: string | undefined | null, b: string): boolean {
  const na = normalizeFingerprint(a);
  const nb = normalizeFingerprint(b);
  return na !== null && nb !== null && na === nb;
}

/**
 * Decide whether a TLS certificate error from Electron's `certificate-error`
 * event should be IGNORED (i.e. we trust this cert), scoped as tightly as
 * possible: ONLY for the app's own loopback HTTPS server. That means the
 * request URL is `https://desktop.moxxy.ai:<one-of-our-ports>` AND the
 * presented cert's SHA-256 fingerprint matches the one we minted. Every other
 * cert error (any other host, any other port, any other fingerprint) falls
 * through to normal verification — this is NOT a blanket
 * `ignore-certificate-errors`.
 *
 * Pure + electron-free so it's unit-testable; the main process wires it into
 * `app.on('certificate-error', …)`.
 */
export function isTrustedLoopbackCert(args: {
  /** The request URL Electron reports (e.g. `https://desktop.moxxy.ai:51789/…`). */
  readonly url: string;
  /** The presented leaf cert's SHA-256 fingerprint (Electron's
   *  `certificate.fingerprint`, typically `sha256/…` base64 OR colon-hex). */
  readonly fingerprint: string | undefined | null;
  /** The fingerprint of the cert WE minted for the loopback server. */
  readonly expectedFingerprint: string;
  /** The fixed loopback ports the app serves on. */
  readonly allowedPorts: readonly number[];
  /** Override the expected host (tests / future-proofing). */
  readonly host?: string;
}): boolean {
  const host = args.host ?? DESKTOP_APP_HOST;
  let u: URL;
  try {
    u = new URL(args.url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.hostname !== host) return false;
  const port = Number(u.port);
  if (!args.allowedPorts.includes(port)) return false;
  return sameFingerprint(args.fingerprint, args.expectedFingerprint);
}

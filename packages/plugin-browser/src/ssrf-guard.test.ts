import { afterEach, describe, expect, it } from 'vitest';
import { assertPublicUrl, isBlockedIp, setSsrfDnsResolver, SsrfBlockedError } from './ssrf-guard.js';

afterEach(() => setSsrfDnsResolver(null));

describe('assertPublicUrl (shared SSRF guard)', () => {
  it('blocks the cloud metadata IP literal', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private|loopback/,
    );
  });

  it('blocks localhost without consulting DNS', async () => {
    setSsrfDnsResolver(async () => {
      throw new Error('resolver should not be consulted for localhost');
    });
    await expect(assertPublicUrl('http://localhost:8080/admin')).rejects.toThrow(/loopback/);
  });

  it('blocks RFC-1918 literals', async () => {
    await expect(assertPublicUrl('http://10.0.0.5/')).rejects.toThrow(/private|loopback/);
    await expect(assertPublicUrl('http://192.168.1.1/')).rejects.toThrow(/private|loopback/);
    await expect(assertPublicUrl('http://172.16.0.1/')).rejects.toThrow(/private|loopback/);
  });

  it('blocks IPv6 loopback / link-local / unique-local', async () => {
    await expect(assertPublicUrl('http://[::1]:3000/')).rejects.toThrow(/private|loopback/);
    await expect(assertPublicUrl('http://[fe80::1]/')).rejects.toThrow(/private|loopback/);
    await expect(assertPublicUrl('http://[fd00::1]/')).rejects.toThrow(/private|loopback/);
  });

  it('blocks v4-mapped IPv6 in the HEX form the URL parser actually produces', async () => {
    // new URL('http://[::ffff:127.0.0.1]/').hostname === '::ffff:7f00:1' — the
    // dotted spelling never reaches the guard via a real URL, so the guard must
    // recognize the hex form. Driving through assertPublicUrl exercises the same
    // canonicalization a real request hits (the regression the dotted-only check
    // missed: loopback AND the cloud-metadata endpoint slipped straight past).
    await expect(assertPublicUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow(/private|loopback/);
    await expect(assertPublicUrl('http://[::ffff:169.254.169.254]/latest/meta-data/')).rejects.toThrow(
      /private|loopback/,
    );
    await expect(assertPublicUrl('http://[::ffff:192.168.1.1]/')).rejects.toThrow(/private|loopback/);
    await expect(assertPublicUrl('http://[::ffff:10.0.0.1]/')).rejects.toThrow(/private|loopback/);
  });

  it('still allows a v4-mapped PUBLIC address (the embedded v4 is what matters)', async () => {
    // ::ffff:93.184.216.34 → public; must NOT be blocked just for being v4-mapped.
    await expect(assertPublicUrl('http://[::ffff:93.184.216.34]/')).resolves.toBeNull();
  });

  it('fail-closed mode rejects an unresolvable host (browser paths)', async () => {
    setSsrfDnsResolver(async () => {
      throw new Error('NXDOMAIN');
    });
    // Default (web_fetch) fails OPEN: a name it can't resolve is no vector.
    await expect(assertPublicUrl('https://nope.invalid/')).resolves.toBeNull();
    // failClosed (browser goto / navigation guard) SOFT-BLOCKS instead.
    await expect(
      assertPublicUrl('https://nope.invalid/', 'goto', { failClosed: true }),
    ).rejects.toThrow(/DNS resolution failed/);
  });

  it('blocks non-HTTP(S) schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/scheme/);
    await expect(assertPublicUrl('javascript:alert(1)')).rejects.toThrow(/scheme/);
  });

  it('blocks a hostname that resolves to a private address', async () => {
    setSsrfDnsResolver(async () => ['10.0.0.5']);
    await expect(assertPublicUrl('https://intranet.example.com/')).rejects.toThrow(
      /private|loopback/,
    );
  });

  it('allows a public IP literal and a publicly-resolving hostname', async () => {
    // IP literal: nothing resolved, nothing to pin.
    await expect(assertPublicUrl('https://93.184.216.34/')).resolves.toBeNull();
    setSsrfDnsResolver(async () => ['93.184.216.34']);
    // Hostname: the vetted addresses come back so callers can pin them.
    await expect(assertPublicUrl('https://example.com/')).resolves.toEqual(['93.184.216.34']);
  });

  it('throws SsrfBlockedError with the caller label prefixed', async () => {
    const err = await assertPublicUrl('http://127.0.0.1/', 'browser_session').catch((e) => e);
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as Error).message).toMatch(/^browser_session:/);
  });
});

describe('isBlockedIp', () => {
  it('blocks unparseable input', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
  });
  it('passes public v4 and v6', () => {
    expect(isBlockedIp('93.184.216.34')).toBe(false);
    expect(isBlockedIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });
  it('blocks v4-mapped private v6', () => {
    expect(isBlockedIp('::ffff:192.168.1.1')).toBe(true);
  });
  it('blocks v4-mapped private v6 in HEX form (the URL-canonicalized spelling)', () => {
    expect(isBlockedIp('::ffff:7f00:1')).toBe(true); // 127.0.0.1
    expect(isBlockedIp('::ffff:a9fe:a9fe')).toBe(true); // 169.254.169.254 metadata
    expect(isBlockedIp('::ffff:c0a8:101')).toBe(true); // 192.168.1.1
  });
  it('does NOT block a v4-mapped PUBLIC address', () => {
    expect(isBlockedIp('::ffff:5db8:d822')).toBe(false); // 93.184.216.34
  });
});

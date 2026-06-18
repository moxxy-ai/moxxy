import { describe, expect, it } from 'vitest';
import {
  checkFsCap,
  checkNetCap,
  checkAllCaps,
  maskEnv,
  pathInScope,
  urlInScope,
} from './cap-check.js';

describe('checkFsCap', () => {
  it('passes when no path-like input is present', () => {
    const r = checkFsCap({ count: 3, name: 'foo' }, undefined, '/work');
    expect(r.ok).toBe(true);
  });

  it('denies path inputs when no fs cap is declared', () => {
    const r = checkFsCap({ file: '/etc/passwd' }, undefined, '/work');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no fs capability/);
  });

  it('accepts paths inside $cwd glob', () => {
    const r = checkFsCap(
      { file: '/work/src/main.ts' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(true);
  });

  it('rejects paths outside $cwd', () => {
    const r = checkFsCap(
      { file: '/etc/passwd' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside/);
  });

  it('accepts file:// URLs that map under the glob', () => {
    const r = checkFsCap(
      { src: 'file:///work/src/x.ts' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(true);
  });

  // u105-9: a host-qualified file URL is not a local path — old code sliced
  // the prefix to `evil/secret` and resolved it under cwd (a false ALLOW for
  // an in-cwd lookalike). It must be denied.
  it('denies a host-qualified file:// URL (not a local path)', () => {
    const r = checkFsCap(
      { src: 'file://evil/work/secret' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(false);
  });

  // u105-9: percent-encoded escapes must be decoded before the in-scope check.
  it('decodes percent-encoded file:// paths so traversal is caught', () => {
    // `%2e%2e` is `..`; decoded the path escapes cwd and must be denied.
    const r = checkFsCap(
      { src: 'file:///work/%2e%2e/etc/passwd' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(false);
  });

  it('decodes a percent-encoded in-scope file:// path (spaces)', () => {
    const r = checkFsCap(
      { src: 'file:///work/a%20b.ts' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(true);
  });

  it('detects file_path (snake_case) as a path field', () => {
    const r = checkFsCap(
      { file_path: '/etc/passwd' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(false);
  });

  it('detects filePath (camelCase) as a path field', () => {
    const r = checkFsCap(
      { filePath: '/etc/passwd' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(false);
  });

  it('detects outputDir as a path field', () => {
    const r = checkFsCap(
      { outputDir: '/etc' },
      { write: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(false);
  });

  it('does NOT scan command strings or generic value fields', () => {
    // Bash-shaped input: `command` is an opaque string. The inproc
    // isolator can't enforce on shell commands; that's by design.
    const r = checkFsCap(
      { command: 'cat /etc/passwd', cwd: '/work' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(true);
  });

  it('does NOT flag absolute paths embedded in prose', () => {
    const r = checkFsCap(
      { description: 'see /usr/bin/foo for details' },
      { read: ['$cwd/**'] },
      '/work',
    );
    expect(r.ok).toBe(true);
  });
});

describe('checkNetCap', () => {
  it('passes when no URL is present', () => {
    const r = checkNetCap({ x: 1 }, undefined);
    expect(r.ok).toBe(true);
  });

  it('denies URL inputs when net mode is none', () => {
    const r = checkNetCap({ url: 'https://example.com/' }, { mode: 'none' });
    expect(r.ok).toBe(false);
  });

  it('accepts URLs when net mode is any', () => {
    const r = checkNetCap({ url: 'https://example.com/' }, { mode: 'any' });
    expect(r.ok).toBe(true);
  });

  it('enforces host allowlist exactly', () => {
    const cap = { mode: 'allowlist' as const, hosts: ['api.example.com'] };
    expect(checkNetCap({ url: 'https://api.example.com/x' }, cap).ok).toBe(true);
    expect(checkNetCap({ url: 'https://evil.com/x' }, cap).ok).toBe(false);
  });

  it('allows subdomains via wildcard hosts', () => {
    const cap = { mode: 'allowlist' as const, hosts: ['*.example.com'] };
    expect(checkNetCap({ url: 'https://api.example.com/' }, cap).ok).toBe(true);
    expect(checkNetCap({ url: 'https://example.com/' }, cap).ok).toBe(false);
  });
});

describe('checkAllCaps', () => {
  it('returns the first failing cap', () => {
    const r = checkAllCaps(
      { url: 'https://evil.com', file: '/work/x' },
      { net: { mode: 'none' }, fs: { read: ['$cwd/**'] } },
      '/work',
    );
    expect(r.ok).toBe(false);
  });
});

describe('maskEnv', () => {
  it('returns only the allowlisted env keys', () => {
    const env = { HOME: '/home/x', SECRET: 'shh', PATH: '/usr/bin' };
    expect(maskEnv(env, ['HOME', 'PATH'])).toEqual({ HOME: '/home/x', PATH: '/usr/bin' });
  });

  it('returns empty when no allowlist is provided', () => {
    expect(maskEnv({ HOME: '/x' }, undefined)).toEqual({});
  });
});

// pathInScope is the broker's per-syscall fs gate; it routes through the
// internal matchesGlob, so these lock the glob edges the audit flagged
// (single-* vs slash, /** parent special case, traversal, sibling-prefix dirs).
describe('pathInScope (matchesGlob edges)', () => {
  const cwd = '/work';
  const cap = (read: string[]) => ({ read });

  const cases: Array<[string, string[], boolean]> = [
    // /** matches the dir itself and everything under it
    ['/work', ['/work/**'], true],
    ['/work/a/b.txt', ['/work/**'], true],
    // sibling-prefix dir must NOT match (the /work2 vs /work/** trap)
    ['/work2/x', ['/work/**'], false],
    // single * stays within one segment, does not cross '/'
    ['/work/a.txt', ['/work/*'], true],
    ['/work/a/b.txt', ['/work/*'], false],
    // ** crosses slashes
    ['/work/a/b/c.txt', ['/work/**/c.txt'], true],
    // path traversal collapses via normalize before matching
    ['/work/../etc/passwd', ['/work/**'], false],
    // $cwd expansion
    ['/work/sub/x', ['$cwd/**'], true],
    ['/elsewhere/x', ['$cwd/**'], false],
    // literal pattern (no wildcards) only matches itself
    ['/work/exact', ['/work/exact'], true],
    ['/work/exactly', ['/work/exact'], false],
  ];

  it.each(cases)('read %s vs %j => %s', (filePath, globs, expected) => {
    expect(pathInScope(filePath, cap(globs), cwd, 'read')).toBe(expected);
  });

  it('denies when no cap or empty globs', () => {
    expect(pathInScope('/work/x', undefined, cwd, 'read')).toBe(false);
    expect(pathInScope('/work/x', { read: [] }, cwd, 'read')).toBe(false);
  });

  it('uses the write globs for write mode', () => {
    const c = { read: ['/work/**'], write: ['/work/out/**'] };
    expect(pathInScope('/work/in/x', c, cwd, 'write')).toBe(false);
    expect(pathInScope('/work/out/x', c, cwd, 'write')).toBe(true);
  });
});

describe('urlInScope (hostMatches edges)', () => {
  const hosts = (h: string[]) => ({ mode: 'allowlist' as const, hosts: h });

  it('matches an exact host', () => {
    expect(urlInScope('https://example.com/x', hosts(['example.com']))).toBe(true);
  });

  it('rejects a sibling host that merely ends with the pattern', () => {
    // 'evilexample.com' must NOT match 'example.com'
    expect(urlInScope('https://evilexample.com', hosts(['example.com']))).toBe(false);
  });

  it('matches a subdomain under a *. wildcard but not the bare apex', () => {
    expect(urlInScope('https://api.example.com', hosts(['*.example.com']))).toBe(true);
    // host must be strictly longer than the '.example.com' suffix
    expect(urlInScope('https://example.com', hosts(['*.example.com']))).toBe(false);
  });

  it('honors mode none/any', () => {
    expect(urlInScope('https://anything', { mode: 'none' })).toBe(false);
    expect(urlInScope('https://anything', { mode: 'any' })).toBe(true);
  });

  it('rejects an unparseable URL', () => {
    expect(urlInScope('not a url', hosts(['example.com']))).toBe(false);
  });

  it('denies when cap is undefined', () => {
    expect(urlInScope('https://example.com', undefined)).toBe(false);
  });
});

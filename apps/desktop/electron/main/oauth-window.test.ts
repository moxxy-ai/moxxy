/**
 * Unit tests for the OAuth user-agent scrubber + popup host allow-list builder.
 * Extracted from index.ts so the regex logic is testable without Electron.
 */
import { describe, expect, it, vi } from 'vitest';

// Control what Frontend API host the publishable key resolves to.
const clerkFrontendApiHost = vi.fn<(key: string) => string | null>();
vi.mock('@moxxy/desktop-host', () => ({
  clerkFrontendApiHost: (k: string) => clerkFrontendApiHost(k),
}));

import { buildOAuthHostPatterns, cleanOAuthUserAgent } from './oauth-window.js';

describe('cleanOAuthUserAgent', () => {
  it('strips the Electron + app product tokens, collapsing whitespace', () => {
    const ua =
      'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) MoxxyAI Workspaces/0.8.8 Chrome/120 Electron/30.0 Safari/537.36';
    const out = cleanOAuthUserAgent(ua, 'MoxxyAI Workspaces');
    expect(out).not.toMatch(/Electron/i);
    expect(out).not.toMatch(/MoxxyAI Workspaces/);
    expect(out).toMatch(/Chrome\/120/);
    expect(out).not.toMatch(/ {2,}/);
  });

  it('is idempotent — a clean UA passes through unchanged', () => {
    const clean = cleanOAuthUserAgent(
      'Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'MoxxyAI Workspaces',
    );
    expect(cleanOAuthUserAgent(clean, 'MoxxyAI Workspaces')).toBe(clean);
  });

  it('escapes regex metacharacters in the app name', () => {
    const ua = 'Foo App (1.0)/2 Electron/30 Chrome/120';
    // Must not throw on the parens/period, and must remove the named token.
    const out = cleanOAuthUserAgent(ua, 'Foo App (1.0)');
    expect(out).not.toMatch(/Foo App \(1\.0\)/);
  });
});

describe('buildOAuthHostPatterns', () => {
  const matches = (patterns: RegExp[], origin: string): boolean =>
    patterns.some((re) => re.test(origin));

  it('always allows Clerk + the major OAuth providers', () => {
    clerkFrontendApiHost.mockReturnValue(null);
    const p = buildOAuthHostPatterns('pk_test_x');
    expect(matches(p, 'https://foo.clerk.accounts.dev')).toBe(true);
    expect(matches(p, 'https://foo.clerk.com')).toBe(true);
    expect(matches(p, 'https://accounts.google.com')).toBe(true);
    expect(matches(p, 'https://appleid.apple.com')).toBe(true);
    expect(matches(p, 'https://github.com')).toBe(true);
    expect(matches(p, 'https://evil.example.com')).toBe(false);
  });

  it('adds nothing extra for a test key whose host is already covered', () => {
    clerkFrontendApiHost.mockReturnValue('foo.clerk.accounts.dev');
    const base = buildOAuthHostPatterns('pk_test_covered');
    clerkFrontendApiHost.mockReturnValue(null);
    const none = buildOAuthHostPatterns('pk_test_none');
    expect(base.length).toBe(none.length);
  });

  it('folds in a pk_live_ instance Frontend API host + parent-domain wildcard', () => {
    clerkFrontendApiHost.mockReturnValue('clerk.acme.com');
    const p = buildOAuthHostPatterns('pk_live_acme');
    expect(matches(p, 'https://clerk.acme.com')).toBe(true);
    // Parent-domain wildcard covers the account portal subdomain.
    expect(matches(p, 'https://accounts.acme.com')).toBe(true);
    expect(matches(p, 'https://deep.sub.acme.com')).toBe(true);
    // But not a different apex.
    expect(matches(p, 'https://acme.evil.com')).toBe(false);
  });
});

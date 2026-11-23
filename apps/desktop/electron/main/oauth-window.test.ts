/**
 * Unit tests for the OAuth user-agent scrubber + popup host allow-list builder.
 * Extracted from index.ts so the regex logic is testable without Electron.
 */
import { describe, expect, it } from 'vitest';

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

  it('allows the configured instance, portal and supported providers', () => {
    const key = (host: string) => 'pk_test_' + Buffer.from(host + '$').toString('base64');
    const patterns = buildOAuthHostPatterns(key('clerk.acme.com'));
    for (const host of ['accounts.google.com', 'appleid.apple.com', 'github.com', 'clerk.acme.com', 'accounts.acme.com']) {
      expect(matches(patterns, 'https://' + host)).toBe(true);
    }
    for (const host of ['other.acme.com', 'other.clerk.accounts.dev', 'accounts.acme.com.evil.example']) {
      expect(matches(patterns, 'https://' + host)).toBe(false);
    }
    expect(matches(buildOAuthHostPatterns(key('demo.clerk.accounts.dev')), 'https://demo.accounts.dev')).toBe(true);
  });
});

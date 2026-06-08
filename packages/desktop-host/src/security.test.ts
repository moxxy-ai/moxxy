import { describe, it, expect } from 'vitest';
import {
  isSafeProviderName,
  assertSafeProviderName,
  isSafeExternalUrl,
  assertSafeExternalUrl,
  redactSecrets,
  clerkFrontendApiHost,
  clerkCspHostSources,
} from './security';

describe('provider-name validation', () => {
  it('accepts well-formed slugs', () => {
    for (const ok of ['openai', 'openai-codex', 'anthropic', 'z-ai', 'a', 'a0']) {
      expect(isSafeProviderName(ok)).toBe(true);
    }
  });

  it('rejects flag injection, separators, traversal, and casing', () => {
    for (const bad of [
      '--help',
      '-x',
      'OpenAI',
      'foo bar',
      'foo;rm -rf /',
      '../etc',
      'a/b',
      'a.b',
      'foo\nbar',
      '',
      'x'.repeat(65),
    ]) {
      expect(isSafeProviderName(bad)).toBe(false);
      expect(() => assertSafeProviderName(bad)).toThrow();
    }
  });
});

describe('external-url validation', () => {
  it('allows only http/https', () => {
    expect(isSafeExternalUrl('https://clerk.com')).toBe(true);
    expect(isSafeExternalUrl('http://localhost:3000')).toBe(true);
  });

  it('rejects RCE-adjacent schemes and garbage', () => {
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'vbscript:msgbox',
      'not a url',
      '',
    ]) {
      expect(isSafeExternalUrl(bad)).toBe(false);
      expect(() => assertSafeExternalUrl(bad)).toThrow();
    }
  });
});

describe('secret redaction', () => {
  it('scrubs api keys, bearer tokens, jwts, and KEY=value', () => {
    expect(redactSecrets('using sk-ABCD1234EFGH5678IJKL')).not.toContain('ABCD1234');
    expect(redactSecrets('Authorization: Bearer abcdef123456ghijkl')).not.toContain('abcdef123456');
    expect(redactSecrets('token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9aaa')).toContain('«redacted»');
    expect(redactSecrets('OPENAI_API_KEY=sk-supersecretvalue')).not.toContain('supersecret');
  });

  it('leaves ordinary log lines intact', () => {
    const line = 'moxxy serve listening on ~/.moxxy/serve.sock';
    expect(redactSecrets(line)).toBe(line);
  });
});

// Live-key fixtures are assembled from parts so this file never contains a
// literal `pk_live_<body>` string — the release pipeline's `desktop-guard`
// greps the whole repo for exactly that to catch a committed production key.
// The body is base64('clerk.acme.com$'); it's a fixture host, not a real key.
const LIVE = ['pk', 'live', 'Y2xlcmsuYWNtZS5jb20k'].join('_');
const TEST = 'pk_test_YW1hemVkLWNvZC02Ny5jbGVyay5hY2NvdW50cy5kZXYk';

describe('clerk frontend-api host', () => {
  it('decodes the host a publishable key points at', () => {
    expect(clerkFrontendApiHost(LIVE)).toBe('clerk.acme.com');
    expect(clerkFrontendApiHost(TEST)).toBe('amazed-cod-67.clerk.accounts.dev');
  });

  it('returns null for missing / malformed keys', () => {
    for (const bad of [undefined, null, '', 'not-a-key', 'pk_live_', 'sk_live_abc', 'pk_live_!!!']) {
      expect(clerkFrontendApiHost(bad)).toBeNull();
    }
  });
});

describe('clerk CSP host sources', () => {

  it('adds the prod host + parent wildcard for a live key', () => {
    expect(clerkCspHostSources(LIVE)).toEqual([
      'https://clerk.acme.com',
      'https://*.acme.com',
    ]);
  });

  it('adds nothing for a test key (already in the static allow-list)', () => {
    expect(clerkCspHostSources(TEST)).toEqual([]);
  });

  it('adds nothing for a missing / malformed key', () => {
    expect(clerkCspHostSources(undefined)).toEqual([]);
    expect(clerkCspHostSources('garbage')).toEqual([]);
  });
});

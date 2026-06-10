import { describe, it, expect } from 'vitest';
import type { BrowserWindow, Session } from 'electron';
import {
  isSafeProviderName,
  assertSafeProviderName,
  isSafeExternalUrl,
  assertSafeExternalUrl,
  redactSecrets,
  clerkFrontendApiHost,
  clerkCspHostSources,
  clerkAccountPortalHost,
  installAccountPortalRecovery,
  installContentSecurityPolicy,
  lockDownNavigation,
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

describe('navigation lockdown', () => {
  /** Minimal BrowserWindow stand-in: captures the will-navigate/redirect
   *  guards so a test can replay navigations against them. */
  function fakeWindow(currentUrl: string): {
    win: BrowserWindow;
    setUrl: (u: string) => void;
    allows: (url: string) => boolean;
  } {
    let url = currentUrl;
    const handlers = new Map<string, (e: { preventDefault: () => void }, u: string) => void>();
    const wc = {
      getURL: () => url,
      on: (ev: string, fn: (e: { preventDefault: () => void }, u: string) => void) => {
        handlers.set(ev, fn);
      },
      setWindowOpenHandler: () => undefined,
    };
    return {
      win: { webContents: wc } as unknown as BrowserWindow,
      setUrl: (u) => {
        url = u;
      },
      allows: (target) => {
        let prevented = false;
        handlers.get('will-navigate')!({ preventDefault: () => (prevented = true) }, target);
        return !prevented;
      },
    };
  }

  it('blocks every off-origin navigation by default, keeps same-origin', () => {
    const { win, allows } = fakeWindow('https://desktop.moxxy.ai:51789/');
    lockDownNavigation(win);
    expect(allows('https://desktop.moxxy.ai:51789/#focus')).toBe(true);
    expect(allows('https://accounts.google.com/o/oauth2/auth')).toBe(false);
    expect(allows('https://evil.example.com/')).toBe(false);
  });

  it('allows the OAuth round-trip when the hosts are allow-listed', () => {
    const oauth = [/^https:\/\/accounts\.google\.com$/, /^https:\/\/clerk\.moxxy\.ai$/];
    const appOrigins = [/^https:\/\/desktop\.moxxy\.ai:(?:51789|51790|51791|51792)$/];
    const { win, setUrl, allows } = fakeWindow('https://desktop.moxxy.ai:51789/');
    lockDownNavigation(win, { allowOriginPatterns: [...oauth, ...appOrigins] });

    // app → provider
    expect(allows('https://accounts.google.com/o/oauth2/auth?x=1')).toBe(true);
    // provider → FAPI callback (current origin is now Google's)
    setUrl('https://accounts.google.com/o/oauth2/auth?x=1');
    expect(allows('https://clerk.moxxy.ai/v1/oauth_callback?code=…')).toBe(true);
    // FAPI → back to the app: NOT same-origin with the current page, so the
    // serving origin must be allow-listed explicitly for the return leg.
    setUrl('https://clerk.moxxy.ai/v1/oauth_callback');
    expect(allows('https://desktop.moxxy.ai:51789/?__clerk_status=…')).toBe(true);
    // …and anything else stays blocked even with the allow-list installed.
    expect(allows('https://evil.example.com/')).toBe(false);
    expect(allows('not a url')).toBe(false);
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

describe('clerk account-portal host', () => {
  it('derives accounts.<domain> for a live key', () => {
    expect(clerkAccountPortalHost(LIVE)).toBe('accounts.acme.com');
  });

  it('returns null for test keys (portal host is never allow-listed)', () => {
    expect(clerkAccountPortalHost(TEST)).toBeNull();
  });

  it('returns null for missing / malformed keys', () => {
    for (const bad of [undefined, null, '', 'not-a-key', 'pk_live_!!!']) {
      expect(clerkAccountPortalHost(bad)).toBeNull();
    }
  });
});

describe('account-portal recovery net', () => {
  /** Minimal BrowserWindow stand-in: captures the did-navigate handler and
   *  records loadURL calls so a test can replay post-OAuth landings. */
  function fakeWindow(): {
    win: BrowserWindow;
    navigate: (url: string) => void;
    hasHandler: () => boolean;
    loads: string[];
  } {
    const loads: string[] = [];
    let handler: ((e: unknown, url: string) => void) | undefined;
    const wc = {
      on: (ev: string, fn: (e: unknown, url: string) => void) => {
        if (ev === 'did-navigate') handler = fn;
      },
      loadURL: (url: string) => {
        loads.push(url);
        return Promise.resolve();
      },
    };
    return {
      win: { webContents: wc } as unknown as BrowserWindow,
      navigate: (url) => handler?.({}, url),
      hasHandler: () => !!handler,
      loads,
    };
  }

  const APP = 'https://desktop.moxxy.ai:51789/index.html';

  it('loads the app root back when the top frame lands on the portal', () => {
    const { win, navigate, loads } = fakeWindow();
    installAccountPortalRecovery(win, { portalHost: 'accounts.acme.com', appUrl: APP });
    navigate('https://accounts.acme.com/account');
    expect(loads).toEqual([APP]);
  });

  it('ignores every other host (no loop on the recovery load itself)', () => {
    const { win, navigate, loads } = fakeWindow();
    installAccountPortalRecovery(win, { portalHost: 'accounts.acme.com', appUrl: APP });
    navigate(APP); // the recovery load landing
    navigate('https://clerk.acme.com/v1/oauth_callback');
    navigate('https://accounts.google.com/o/oauth2/auth');
    navigate('not a url');
    expect(loads).toEqual([]);
  });

  it('is a no-op without a portal host (test key / no key)', () => {
    const { win, hasHandler } = fakeWindow();
    installAccountPortalRecovery(win, { portalHost: null, appUrl: APP });
    expect(hasHandler()).toBe(false);
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

describe('CSP injection gate', () => {
  type Details = { url: string; responseHeaders?: Record<string, string[]> };
  type Headers = Record<string, string[]> | undefined;

  /** Build a fake Session that captures the onHeadersReceived handler, then
   *  return a probe that runs it for a given URL and reports the resulting
   *  response headers (or null if no handler was registered — dev path). */
  function probe(opts: {
    isDev: boolean;
    clerkPublishableKey?: string | null;
    loopbackOrigin?: string | null;
  }): (url: string) => Headers | null {
    let handler:
      | ((details: Details, cb: (r: { responseHeaders?: Headers }) => void) => void)
      | undefined;
    const session = {
      webRequest: {
        onHeadersReceived: (cb: typeof handler) => {
          handler = cb;
        },
      },
    } as unknown as Session;
    installContentSecurityPolicy(session, opts);
    return (url: string) => {
      if (!handler) return null;
      let out: Headers;
      handler({ url, responseHeaders: { 'x-existing': ['1'] } }, (r) => {
        out = r.responseHeaders;
      });
      return out;
    };
  }

  const LOOPBACK = 'http://127.0.0.1:51789';

  it('injects CSP for file:// and the loopback origin', () => {
    const run = probe({ isDev: false, clerkPublishableKey: LIVE, loopbackOrigin: LOOPBACK });
    for (const url of ['file:///app/dist/index.html', `${LOOPBACK}/index.html`]) {
      const headers = run(url);
      const csp = headers?.['Content-Security-Policy']?.[0] ?? '';
      expect(csp).toContain("default-src 'self'");
      // the live-key prod host folds in
      expect(csp).toContain('https://clerk.acme.com');
    }
  });

  it('passes third-party + OAuth-popup responses through untouched', () => {
    const run = probe({ isDev: false, clerkPublishableKey: LIVE, loopbackOrigin: LOOPBACK });
    for (const url of [
      'https://accounts.google.com/o/oauth2/v2/auth',
      'https://clerk.acme.com/v1/client',
      'http://127.0.0.1:9999/other-origin', // a DIFFERENT loopback port
    ]) {
      const headers = run(url);
      expect(headers?.['Content-Security-Policy']).toBeUndefined();
      expect(headers?.['x-existing']).toEqual(['1']);
    }
  });

  it('registers no handler in dev', () => {
    const run = probe({ isDev: true, clerkPublishableKey: LIVE, loopbackOrigin: LOOPBACK });
    expect(run('file:///x')).toBeNull();
  });

  it('still injects on file:// when no loopback origin (fallback path)', () => {
    const run = probe({ isDev: false, clerkPublishableKey: LIVE, loopbackOrigin: null });
    expect(run('file:///app/index.html')?.['Content-Security-Policy']).toBeDefined();
    expect(run(`${LOOPBACK}/index.html`)?.['Content-Security-Policy']).toBeUndefined();
  });
});

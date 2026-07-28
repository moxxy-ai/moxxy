import { describe, expect, it, vi } from 'vitest';
import {
  hasProxy,
  installEgressProxy,
  parseNoProxy,
  readProxyEnv,
  redactProxyUrl,
  shouldBypassProxy,
} from './egress.js';

describe('readProxyEnv', () => {
  it('reads uppercase and lowercase forms', () => {
    expect(readProxyEnv({ HTTPS_PROXY: 'http://p:3128' })).toEqual({ httpsProxy: 'http://p:3128' });
    expect(readProxyEnv({ https_proxy: 'http://p:3128' })).toEqual({ httpsProxy: 'http://p:3128' });
  });

  // Lowercase wins by convention (curl, requests, Go): a shell exporting both
  // usually set the lowercase one deliberately and more recently.
  it('prefers the lowercase form when both are set', () => {
    const env = { https_proxy: 'http://lower:1', HTTPS_PROXY: 'http://upper:2' };
    expect(readProxyEnv(env).httpsProxy).toBe('http://lower:1');
  });

  it('treats blank and whitespace values as unset', () => {
    expect(readProxyEnv({ HTTPS_PROXY: '', HTTP_PROXY: '   ' })).toEqual({});
  });

  // A plaintext-only proxy declared via http_proxy must not silently swallow
  // TLS traffic; https origins go direct instead of failing confusingly.
  it('does not fall back to http_proxy for https origins', () => {
    expect(readProxyEnv({ HTTP_PROXY: 'http://p:3128' })).toEqual({ httpProxy: 'http://p:3128' });
  });
});

describe('parseNoProxy', () => {
  it('splits on commas and whitespace, lowercases, and drops blanks', () => {
    expect(parseNoProxy(' localhost, .Corp.Example  10.0.0.1 ,, ')).toEqual([
      'localhost',
      '.corp.example',
      '10.0.0.1',
    ]);
  });

  it('returns an empty list for undefined', () => {
    expect(parseNoProxy(undefined)).toEqual([]);
  });
});

describe('shouldBypassProxy', () => {
  const bypass = (origin: string, rules: string): boolean =>
    shouldBypassProxy(origin, parseNoProxy(rules));

  it('bypasses everything on *', () => {
    expect(bypass('https://api.anthropic.com', '*')).toBe(true);
  });

  it('matches an exact host on any port', () => {
    expect(bypass('http://localhost:8080/x', 'localhost')).toBe(true);
    expect(bypass('https://localhost', 'localhost')).toBe(true);
    expect(bypass('https://notlocalhost', 'localhost')).toBe(false);
  });

  // A leading dot covers the apex too, matching curl. Getting this wrong sends
  // internal traffic through the proxy, which is exactly what NO_PROXY exists
  // to prevent.
  it('matches subdomains and the apex for a dotted rule', () => {
    expect(bypass('https://api.corp.example', '.corp.example')).toBe(true);
    expect(bypass('https://corp.example', '.corp.example')).toBe(true);
    expect(bypass('https://deep.api.corp.example', '.corp.example')).toBe(true);
    expect(bypass('https://evilcorp.example', '.corp.example')).toBe(false);
  });

  it('treats *.domain the same as .domain', () => {
    expect(bypass('https://api.corp.example', '*.corp.example')).toBe(true);
  });

  it('honours a port qualifier', () => {
    expect(bypass('http://registry.internal:8081/x', 'registry.internal:8081')).toBe(true);
    expect(bypass('http://registry.internal:9999/x', 'registry.internal:8081')).toBe(false);
  });

  it('resolves the implicit port from the scheme', () => {
    expect(bypass('https://svc.internal/x', 'svc.internal:443')).toBe(true);
    expect(bypass('http://svc.internal/x', 'svc.internal:80')).toBe(true);
    expect(bypass('https://svc.internal/x', 'svc.internal:80')).toBe(false);
  });

  // `::1` must not be read as host ":" on port "1".
  it('does not mistake an IPv6 literal for a host:port rule', () => {
    expect(bypass('http://[::1]:7000/x', '::1')).toBe(true);
  });

  it('is case-insensitive on the host', () => {
    expect(bypass('https://API.Corp.Example', '.corp.example')).toBe(true);
  });

  it('never bypasses with no rules, or on an unparseable origin', () => {
    expect(bypass('https://api.anthropic.com', '')).toBe(false);
    expect(shouldBypassProxy('not a url', ['*.corp.example'])).toBe(false);
  });
});

describe('redactProxyUrl', () => {
  it('masks embedded credentials', () => {
    expect(redactProxyUrl('http://alice:hunter2@proxy.corp:3128')).toBe('http://***:***@proxy.corp:3128/');
  });

  it('leaves a credential-free url intact', () => {
    expect(redactProxyUrl('http://proxy.corp:3128')).toBe('http://proxy.corp:3128/');
  });

  // Never echo something unparseable: it might be a secret pasted by mistake.
  it('reveals nothing for an unparseable value', () => {
    expect(redactProxyUrl('hunter2')).toBe('<invalid proxy url>');
  });
});

describe('installEgressProxy', () => {
  /**
   * Stand-in for undici. Each agent reports its own label through the dispatch
   * handler, so `routeOf` observes WHICH agent the router picked for an origin,
   * which is the whole contract worth testing here.
   */
  const fakeUndici = () => {
    let installed: { dispatch: (o: { origin?: string }, h: unknown) => boolean } | null = null;
    const agent = (label: string) => ({
      dispatch: (_o: unknown, h: { onPick?: (l: string) => void }) => {
        h.onPick?.(label);
        return true;
      },
      close: async () => {},
      destroy: async () => {},
    });
    return {
      routeOf: (origin: string): string => {
        let picked = '';
        installed!.dispatch({ origin }, {
          onPick: (l: string) => {
            picked = l;
          },
        });
        return picked;
      },
      module: {
        Agent: function Agent() {
          return agent('direct');
        } as never,
        ProxyAgent: function ProxyAgent(o: { uri: string }) {
          return agent(`proxy:${o.uri}`);
        } as never,
        setGlobalDispatcher: (d: never) => {
          installed = d;
        },
      },
    };
  };

  it('no-ops when no proxy is configured', async () => {
    const status = await installEgressProxy({});
    expect(status).toEqual({ enabled: false, reason: 'no proxy configured' });
  });

  it('reports and skips an unparseable proxy url instead of throwing', async () => {
    const warn = vi.fn();
    const status = await installEgressProxy({ httpsProxy: 'not a url' }, { warn });
    expect(status.enabled).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('https_proxy is not a valid URL'));
  });

  // A proxy is configured but the dependency is missing: degrade to direct with
  // a loud warning rather than a failed boot.
  it('warns and degrades when undici cannot be loaded', async () => {
    const warn = vi.fn();
    const status = await installEgressProxy(
      { httpsProxy: 'http://p:3128' },
      { warn, loadUndici: () => Promise.reject(new Error('not installed')) },
    );
    expect(status.enabled).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`undici` package is unavailable'));
  });

  it('installs a dispatcher and redacts credentials in the reported status', async () => {
    const u = fakeUndici();
    const status = await installEgressProxy(
      { httpsProxy: 'http://bob:secret@p:3128', noProxy: 'localhost' },
      { loadUndici: async () => u.module as never },
    );
    expect(status.enabled).toBe(true);
    expect(status.httpsProxy).toBe('http://***:***@p:3128/');
    expect(status.httpsProxy).not.toContain('secret');
    expect(status.noProxy).toEqual(['localhost']);
  });

  it('routes https through the proxy and bypassed hosts direct', async () => {
    const u = fakeUndici();
    await installEgressProxy(
      { httpsProxy: 'http://p:3128', noProxy: '.corp.example' },
      { loadUndici: async () => u.module as never },
    );
    expect(u.routeOf('https://api.anthropic.com')).toBe('proxy:http://p:3128');
    expect(u.routeOf('https://git.corp.example')).toBe('direct');
  });

  // Only http_proxy set: https origins must go direct, not through it.
  it('sends https direct when only an http proxy is configured', async () => {
    const u = fakeUndici();
    await installEgressProxy(
      { httpProxy: 'http://p:3128' },
      { loadUndici: async () => u.module as never },
    );
    expect(u.routeOf('http://example.com')).toBe('proxy:http://p:3128');
    expect(u.routeOf('https://example.com')).toBe('direct');
  });
});

describe('hasProxy', () => {
  it('is true when either proxy is set', () => {
    expect(hasProxy({})).toBe(false);
    expect(hasProxy({ noProxy: 'localhost' })).toBe(false);
    expect(hasProxy({ httpProxy: 'http://p' })).toBe(true);
    expect(hasProxy({ httpsProxy: 'http://p' })).toBe(true);
  });
});

describe('shouldBypassProxy IPv6 port qualifiers', () => {
  const bypass = (origin: string, rules: string): boolean =>
    shouldBypassProxy(origin, parseNoProxy(rules));

  // A port on an IPv6 address requires brackets, exactly as in a URL.
  it('honours a bracketed IPv6 host:port rule', () => {
    expect(bypass('http://[::1]:7000/x', '[::1]:7000')).toBe(true);
    expect(bypass('http://[::1]:9999/x', '[::1]:7000')).toBe(false);
  });

  it('matches a bracketed IPv6 rule on any port', () => {
    expect(bypass('http://[::1]:7000/x', '[::1]')).toBe(true);
  });
});

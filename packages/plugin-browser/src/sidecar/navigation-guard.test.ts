import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installNavigationSsrfGuard } from './install.js';
import { setSsrfDnsResolver } from '../ssrf-guard.js';
import type { PlaywrightHandle, RouteHandle } from './types.js';

/**
 * A page reached by a vetted goto can still redirect or script-navigate
 * itself. The context-wide route guard catches those navigations; a page on
 * this computer passes it only at the address and port the person allowed.
 */

type Handler = (route: RouteHandle) => Promise<void> | void;

async function guardedContext(localSites: () => readonly string[]): Promise<(url: string) => Promise<string>> {
  let handler: Handler | null = null;
  const context = {
    newPage: async () => ({}),
    close: async () => {},
    route: async (_pattern: string, h: Handler) => {
      handler = h;
    },
  } as unknown as PlaywrightHandle['context'];
  await installNavigationSsrfGuard(context, localSites);
  return async (url) => {
    let verdict = 'none';
    const route = {
      request: () => ({ url: () => url, isNavigationRequest: () => true }),
      abort: async () => {
        verdict = 'blocked';
      },
      continue: async () => {
        verdict = 'allowed';
      },
    } as unknown as RouteHandle;
    if (!handler) throw new Error('route guard not installed');
    await handler(route);
    return verdict;
  };
}

beforeEach(() => setSsrfDnsResolver(async () => ['93.184.216.34']));
afterEach(() => setSsrfDnsResolver(null));

describe('the in-page navigation guard', () => {
  it('lets a navigation to an allowed local page through, and no other', async () => {
    const navigate = await guardedContext(() => ['localhost:5173']);

    expect(await navigate('http://localhost:5173/login')).toBe('allowed');
    expect(await navigate('http://localhost:8080/')).toBe('blocked');
    expect(await navigate('http://169.254.169.254/latest/meta-data/')).toBe('blocked');
    expect(await navigate('https://example.com/')).toBe('allowed');
  });

  it('follows the grants as they change, without a stale verdict', async () => {
    let sites: readonly string[] = [];
    const navigate = await guardedContext(() => sites);

    expect(await navigate('http://localhost:5173/')).toBe('blocked');
    sites = ['localhost:5173'];
    expect(await navigate('http://localhost:5173/')).toBe('allowed');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, type SidecarState } from './dispatch.js';
import type { Err, Ok, PlaywrightHandle } from './types.js';
import { setSsrfDnsResolver } from '../ssrf-guard.js';

/**
 * Dispatch-level SSRF tests: the sidecar is a separate process that must not
 * trust the parent to have validated `goto` URLs. The guard must fire BEFORE
 * Playwright is touched — these tests run with `state.handle` unset for
 * blocked URLs, so reaching `ensurePlaywright` (and its `import('playwright')`)
 * would fail loudly.
 */

function makeFakeHandle(): { handle: PlaywrightHandle; gotos: string[] } {
  const gotos: string[] = [];
  let current = 'about:blank';
  const handle: PlaywrightHandle = {
    browser: { close: async () => {} },
    context: { newPage: async () => ({}), close: async () => {} },
    page: {
      goto: async (url: string) => {
        gotos.push(url);
        current = url;
        return undefined;
      },
      click: async () => {},
      fill: async () => {},
      textContent: async () => null,
      content: async () => '',
      screenshot: async () => Buffer.alloc(0),
      evaluate: async () => undefined,
      url: () => current,
      close: async () => {},
    },
  };
  return { handle, gotos };
}

function gotoReq(url: string): { id: string; method: string; params: { url: string } } {
  return { id: 'r1', method: 'goto', params: { url } };
}

describe('sidecar dispatch goto SSRF guard', () => {
  beforeEach(() => {
    // Hermetic DNS: any hostname "resolves" public unless a test overrides.
    setSsrfDnsResolver(async () => ['93.184.216.34']);
  });
  afterEach(() => {
    setSsrfDnsResolver(null);
    vi.restoreAllMocks();
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:8080/',
    'http://10.0.0.5/internal',
    'file:///etc/passwd',
  ])('rejects %s without launching a browser', async (url) => {
    const state: SidecarState = { handle: null, pendingInstallNotice: null };
    const reply = (await dispatch(state, gotoReq(url))) as Err;
    expect(reply.ok).toBe(false);
    expect(reply.error.kind).toBe('navigation');
    expect(reply.error.message).toMatch(/loopback|private|scheme/);
    expect(state.handle).toBeNull(); // never reached ensurePlaywright
  });

  it('rejects a hostname that resolves to a private address', async () => {
    setSsrfDnsResolver(async () => ['192.168.0.10']);
    const state: SidecarState = { handle: null, pendingInstallNotice: null };
    const reply = (await dispatch(state, gotoReq('https://intranet.example.com/'))) as Err;
    expect(reply.ok).toBe(false);
    expect(reply.error.message).toMatch(/private|loopback/);
  });

  it('navigates a public URL on the (pre-seeded) page', async () => {
    const { handle, gotos } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, gotoReq('https://example.com/'))) as Ok;
    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual({ url: 'https://example.com/' });
    expect(gotos).toEqual(['https://example.com/']);
  });
});

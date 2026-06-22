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

interface HandleCalls {
  gotos: string[];
  clicks: Array<{ x: number; y: number }>;
  wheels: Array<{ dx: number; dy: number }>;
  presses: string[];
  types: string[];
  evals: string[];
}

function makeFakeHandle(opts?: {
  evalResult?: unknown;
  textContent?: string | null;
  content?: string;
  viewport?: { width: number; height: number } | null;
}): { handle: PlaywrightHandle; gotos: string[]; calls: HandleCalls } {
  const calls: HandleCalls = { gotos: [], clicks: [], wheels: [], presses: [], types: [], evals: [] };
  let current = 'about:blank';
  const handle: PlaywrightHandle = {
    browser: { close: async () => {} },
    context: { newPage: async () => ({}), close: async () => {} },
    page: {
      goto: async (url: string) => {
        calls.gotos.push(url);
        current = url;
        return undefined;
      },
      click: async () => {},
      fill: async () => {},
      textContent: async () => (opts && 'textContent' in opts ? (opts.textContent ?? null) : null),
      content: async () => opts?.content ?? '',
      screenshot: async () => Buffer.from('screenshot-bytes'),
      evaluate: async (expr: string) => {
        calls.evals.push(expr);
        return opts && 'evalResult' in opts ? opts.evalResult : undefined;
      },
      url: () => current,
      close: async () => {},
      viewportSize: () => (opts && 'viewport' in opts ? (opts.viewport ?? null) : { width: 800, height: 600 }),
      mouse: {
        click: async (x: number, y: number) => {
          calls.clicks.push({ x, y });
        },
        wheel: async (dx: number, dy: number) => {
          calls.wheels.push({ dx, dy });
        },
      },
      keyboard: {
        press: async (key: string) => {
          calls.presses.push(key);
        },
        type: async (text: string) => {
          calls.types.push(text);
        },
      },
    },
  };
  return { handle, gotos: calls.gotos, calls };
}

function req(method: string, params: Record<string, unknown> = {}): { id: string; method: string; params: Record<string, unknown> } {
  return { id: 'r1', method, params };
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

describe('sidecar dispatch removed screencast methods', () => {
  // The CDP screencast push path was orphaned by the PR #205 polling revert and
  // deleted. Its former methods must now fall through to the default branch and
  // report `unknown method` (not silently succeed). Uses a pre-seeded handle so
  // we never reach `ensurePlaywright` / a real Playwright import.
  it.each(['startScreencast', 'stopScreencast'])(
    'reports %s as an unknown method',
    async (method) => {
      const { handle } = makeFakeHandle();
      const state: SidecarState = { handle, pendingInstallNotice: null };
      const reply = (await dispatch(state, { id: 'r1', method, params: {} })) as Err;
      expect(reply.ok).toBe(false);
      expect(reply.error.kind).toBe('runtime');
      expect(reply.error.message).toBe(`unknown method: ${method}`);
    },
  );
});

describe('sidecar dispatch protocol methods (against a pre-seeded handle)', () => {
  // Each test pre-seeds state.handle so `ensurePlaywright` short-circuits and no
  // real Playwright import / launch happens. These assert the exact wire shapes
  // the surface + tool callers consume.

  it('text without a selector reads whole-document innerText via evaluate', async () => {
    const { handle, calls } = makeFakeHandle({ evalResult: 'page body text' });
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('text'))) as Ok;
    expect(reply.ok).toBe(true);
    expect(reply.result).toBe('page body text');
    expect(calls.evals).toHaveLength(1);
  });

  it('text with a selector returns its textContent (empty string when null)', async () => {
    const { handle } = makeFakeHandle({ textContent: null });
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('text', { selector: 'main' }))) as Ok;
    expect(reply.ok).toBe(true);
    expect(reply.result).toBe('');
  });

  it('html returns the page content', async () => {
    const { handle } = makeFakeHandle({ content: '<html>x</html>' });
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('html'))) as Ok;
    expect(reply.result).toBe('<html>x</html>');
  });

  it('screenshot returns a png mediaType + base64 payload', async () => {
    const { handle } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('screenshot'))) as Ok;
    expect(reply.result).toEqual({
      mediaType: 'image/png',
      base64: Buffer.from('screenshot-bytes').toString('base64'),
    });
  });

  it('frame returns jpeg + url + viewport dimensions', async () => {
    const { handle } = makeFakeHandle({ viewport: { width: 1024, height: 768 } });
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('frame'))) as Ok;
    expect(reply.result).toEqual({
      mediaType: 'image/jpeg',
      base64: Buffer.from('screenshot-bytes').toString('base64'),
      url: 'about:blank',
      width: 1024,
      height: 768,
    });
  });

  it('frame falls back to 1280x720 when viewportSize() is null', async () => {
    const { handle } = makeFakeHandle({ viewport: null });
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('frame'))) as Ok;
    expect(reply.result).toMatchObject({ width: 1280, height: 720 });
  });

  it('mouse forwards finite coords to page.mouse.click and returns the url', async () => {
    const { handle, calls } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('mouse', { x: 12, y: 34 }))) as Ok;
    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual({ url: 'about:blank' });
    expect(calls.clicks).toEqual([{ x: 12, y: 34 }]);
  });

  it.each([
    ['missing both', {}],
    ['missing y', { x: 5 }],
    ['NaN x', { x: Number.NaN, y: 2 }],
  ])('mouse with %s coords returns a runtime badParams without touching the page', async (_label, params) => {
    const { handle, calls } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('mouse', params))) as Err;
    expect(reply.ok).toBe(false);
    expect(reply.error.kind).toBe('runtime');
    expect(calls.clicks).toHaveLength(0);
  });

  it('key types a single printable char and presses a named key', async () => {
    const { handle, calls } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    expect(((await dispatch(state, req('key', { key: 'a' }))) as Ok).ok).toBe(true);
    expect(((await dispatch(state, req('key', { key: 'Enter' }))) as Ok).ok).toBe(true);
    expect(calls.types).toEqual(['a']);
    expect(calls.presses).toEqual(['Enter']);
  });

  it('key without a key value returns a runtime badParams', async () => {
    const { handle } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('key', {}))) as Err;
    expect(reply.ok).toBe(false);
    expect(reply.error.kind).toBe('runtime');
  });

  it('scroll forwards dy to mouse.wheel and defaults missing dy to 0', async () => {
    const { handle, calls } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    await dispatch(state, req('scroll', { dy: 120 }));
    await dispatch(state, req('scroll', {}));
    expect(calls.wheels).toEqual([
      { dx: 0, dy: 120 },
      { dx: 0, dy: 0 },
    ]);
  });

  it('eval forwards the expression and returns its value', async () => {
    const { handle, calls } = makeFakeHandle({ evalResult: 42 });
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('eval', { expression: '1 + 41' }))) as Ok;
    expect(reply.result).toBe(42);
    expect(calls.evals).toEqual(['1 + 41']);
  });

  it('eval without an expression returns a runtime badParams', async () => {
    const { handle } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('eval', {}))) as Err;
    expect(reply.ok).toBe(false);
    expect(reply.error.kind).toBe('runtime');
  });

  it('url returns the current page url', async () => {
    const { handle } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('url'))) as Ok;
    expect(reply.result).toBe('about:blank');
  });

  it('close tears down the handle and is idempotent', async () => {
    const { handle } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    expect(((await dispatch(state, req('close'))) as Ok).ok).toBe(true);
    expect(state.handle).toBeNull();
    // A second close (handle already null) still replies ok.
    expect(((await dispatch(state, req('close'))) as Ok).ok).toBe(true);
  });

  it.each([
    ['setviewport', { width: 1e9, height: 100 }],
    ['setviewport', { width: 100, height: 1e9 }],
    ['capture', { x: 0, y: 0, width: 100_000, height: 10 }],
    ['capture', { x: 0, y: 0, width: 10, height: 100_000 }],
  ])('%s with an over-limit dimension returns badParams without launching a browser', async (method, params) => {
    // state.handle stays null so reaching ensurePlaywright (a real Playwright
    // import) would fail loudly — the dimension clamp must fire first.
    const state: SidecarState = { handle: null, pendingInstallNotice: null };
    const reply = (await dispatch(state, req(method, params))) as Err;
    expect(reply.ok).toBe(false);
    expect(reply.error.kind).toBe('runtime');
    expect(reply.error.message).toMatch(/<=|must be/);
    expect(state.handle).toBeNull();
  });

  it('click requires a selector', async () => {
    const { handle } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('click', {}))) as Err;
    expect(reply.ok).toBe(false);
    expect(reply.error.kind).toBe('runtime');
  });

  it('fill requires a selector', async () => {
    const { handle } = makeFakeHandle();
    const state: SidecarState = { handle, pendingInstallNotice: null };
    const reply = (await dispatch(state, req('fill', { value: 'x' }))) as Err;
    expect(reply.ok).toBe(false);
    expect(reply.error.kind).toBe('runtime');
  });
});

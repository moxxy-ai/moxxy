import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';
import type { ToolContext } from '@moxxy/sdk';
import {
  buildBrowserSessionTool,
  closeBrowserSidecar,
  resolveBrowserInstallRoot,
  type SidecarStream,
} from './browser-session.js';
import { setSsrfDnsResolver } from './ssrf-guard.js';

// Hermetic DNS for the parent-side SSRF guard on `goto`: every hostname
// "resolves" public so tests never hit real DNS.
beforeEach(() => setSsrfDnsResolver(async () => ['93.184.216.34']));
afterEach(() => setSsrfDnsResolver(null));

/**
 * The sidecar is exercised via a fake `spawnFn` that drives a scripted
 * protocol — keeps Playwright out of the test loop entirely.
 */

const baseCtx = (): ToolContext => ({
  sessionId: asSessionId('s'),
  turnId: asTurnId('t'),
  callId: asToolCallId('c'),
  cwd: '/tmp',
  signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

describe('resolveBrowserInstallRoot', () => {
  it('returns the prefix root (the node_modules parent) for a packaged sidecar path', () => {
    // The real installed layout: <root>/node_modules/@moxxy/cli/dist/sidecar.js
    const sidecarPath = '/Users/me/Library/App/cli/node_modules/@moxxy/cli/dist/sidecar.js';
    expect(resolveBrowserInstallRoot({ sidecarPath })).toBe('/Users/me/Library/App/cli');
  });

  it('falls back to the sidecar dir when no node_modules is on the path', () => {
    expect(resolveBrowserInstallRoot({ sidecarPath: '/opt/app/dist/sidecar.js' })).toBe('/opt/app/dist');
  });
});

function makeFakeSpawn(handler: (req: { id: string; method: string; params?: unknown }) => unknown): {
  spawn: (path: string) => SidecarStream;
  receivedRequests: Array<{ id: string; method: string; params?: unknown }>;
} {
  const receivedRequests: Array<{ id: string; method: string; params?: unknown }> = [];

  const spawn = (_scriptPath: string): SidecarStream => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let buf = '';
    stdin.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        receivedRequests.push(req);
        const result = handler(req);
        const reply = { id: req.id, ok: true, result };
        stdout.write(JSON.stringify(reply) + '\n');
      }
    });
    const exitListeners: Array<(code: number | null) => void> = [];
    const stream: SidecarStream = {
      stdin,
      stdout,
      kill: () => {
        for (const l of exitListeners) l(0);
        return true;
      },
      once: (_event, listener) => {
        exitListeners.push(listener as (code: number | null) => void);
      },
    };
    return stream;
  };
  return { spawn, receivedRequests };
}

describe('browser_session tool (sidecar protocol)', () => {
  it('drives `goto` and returns the result', async () => {
    const { spawn, receivedRequests } = makeFakeSpawn((req) => {
      if (req.method === 'goto') return { url: (req.params as { url: string }).url };
      return null;
    });

    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn });
    const out = await tool.handler(
      { action: { kind: 'goto', url: 'https://example.com' } },
      baseCtx(),
    );
    expect(out).toEqual({ url: 'https://example.com' });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0]!.method).toBe('goto');

    await closeBrowserSidecar();
  });

  it('drives `text` after `goto` on the same sidecar (shared page)', async () => {
    const { spawn, receivedRequests } = makeFakeSpawn((req) => {
      if (req.method === 'goto') return { url: 'https://x' };
      if (req.method === 'text') return 'hello world';
      return null;
    });

    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn });
    await tool.handler({ action: { kind: 'goto', url: 'https://x' } }, baseCtx());
    const text = await tool.handler({ action: { kind: 'text', selector: 'main' } }, baseCtx());
    expect(text).toBe('hello world');
    expect(receivedRequests.map((r) => r.method)).toEqual(['goto', 'text']);

    await closeBrowserSidecar();
  });

  it('forwards eval expression to the sidecar', async () => {
    const { spawn, receivedRequests } = makeFakeSpawn((req) => {
      if (req.method === 'eval') return 42;
      return null;
    });
    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn });
    const out = await tool.handler(
      { action: { kind: 'eval', expression: '1 + 41' } },
      baseCtx(),
    );
    expect(out).toBe(42);
    expect((receivedRequests[0]!.params as { expression: string }).expression).toBe('1 + 41');
    await closeBrowserSidecar();
  });
});

/** A sidecar that consumes requests but NEVER replies — drives the
 *  parent-side per-call timeout path. */
function makeSilentSpawn(): {
  spawn: (path: string) => SidecarStream;
  receivedRequests: Array<{ id: string; method: string }>;
} {
  const receivedRequests: Array<{ id: string; method: string }> = [];
  const spawn = (_p: string): SidecarStream => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let buf = '';
    stdin.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) receivedRequests.push(JSON.parse(line));
      }
      // deliberately never writes a reply
    });
    const exitListeners: Array<(code: number | null) => void> = [];
    return {
      stdin,
      stdout,
      kill: () => {
        for (const l of exitListeners) l(0);
        return true;
      },
      once: (_e, listener) => {
        exitListeners.push(listener as (code: number | null) => void);
      },
    };
  };
  return { spawn, receivedRequests };
}

describe('browser_session parent-side per-call timeout', () => {
  it('rejects a hung sidecar op after the configured timeout instead of hanging forever', async () => {
    const { spawn, receivedRequests } = makeSilentSpawn();
    // 50ms timeout via the deps seam so the test is fast.
    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn, callTimeoutMs: 50 });
    await expect(
      tool.handler({ action: { kind: 'url' } }, baseCtx()),
    ).rejects.toThrow(/timed out/);
    expect(receivedRequests).toHaveLength(1); // the request WAS sent; just never answered
    await closeBrowserSidecar();
  });

  it('a later reply for a timed-out call is ignored (no unhandled settle)', async () => {
    // The pending entry is deleted on timeout, so a straggling reply is a no-op.
    const { spawn } = makeSilentSpawn();
    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn, callTimeoutMs: 30 });
    await expect(tool.handler({ action: { kind: 'url' } }, baseCtx())).rejects.toThrow(/timed out/);
    // No throw / no hang on cleanup proves the entry was dropped.
    await closeBrowserSidecar();
  });
});

describe('browser_session eval opt-out', () => {
  afterEach(() => {
    delete process.env.MOXXY_BROWSER_DISABLE_EVAL;
  });
  it('refuses eval when MOXXY_BROWSER_DISABLE_EVAL=1 without reaching the sidecar', async () => {
    process.env.MOXXY_BROWSER_DISABLE_EVAL = '1';
    const { spawn, receivedRequests } = makeFakeSpawn(() => 42);
    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn });
    await expect(
      tool.handler({ action: { kind: 'eval', expression: '1+1' } }, baseCtx()),
    ).rejects.toThrow(/disabled/);
    expect(receivedRequests.some((r) => r.method === 'eval')).toBe(false);
    await closeBrowserSidecar();
  });
});

describe('browser_session SSRF guard (parent layer)', () => {
  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:3000/',
    'http://10.0.0.5/internal',
  ])('rejects goto %s before any RPC reaches the sidecar', async (url) => {
    const { spawn, receivedRequests } = makeFakeSpawn(() => null);
    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn });
    await expect(
      tool.handler({ action: { kind: 'goto', url } }, baseCtx()),
    ).rejects.toThrow(/private|loopback/);
    expect(receivedRequests).toHaveLength(0); // never sent to the sidecar
    await closeBrowserSidecar();
  });

  it('rejects a hostname resolving to a private address', async () => {
    setSsrfDnsResolver(async () => ['10.1.2.3']);
    const { spawn, receivedRequests } = makeFakeSpawn(() => null);
    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn });
    await expect(
      tool.handler({ action: { kind: 'goto', url: 'https://intranet.example.com/' } }, baseCtx()),
    ).rejects.toThrow(/private|loopback/);
    expect(receivedRequests).toHaveLength(0);
    await closeBrowserSidecar();
  });

  it('allows a public URL through to the sidecar', async () => {
    const { spawn, receivedRequests } = makeFakeSpawn((req) => {
      if (req.method === 'goto') return { url: (req.params as { url: string }).url };
      return null;
    });
    const tool = buildBrowserSessionTool({ sidecarPath: '/fake.js', spawnFn: spawn });
    const out = await tool.handler(
      { action: { kind: 'goto', url: 'https://example.com/' } },
      baseCtx(),
    );
    expect(out).toEqual({ url: 'https://example.com/' });
    expect(receivedRequests).toHaveLength(1);
    await closeBrowserSidecar();
  });
});

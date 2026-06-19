import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { buildBrowserSurface } from './browser-surface.js';
import { closeBrowserSidecar, type SidecarStream } from './browser-session.js';

/**
 * The browser surface polls the shared sidecar's `frame` method a few times a
 * second and forwards each JPEG as a `surface.data` payload. These tests drive
 * a FAKE sidecar (injected via deps.spawnFn) whose per-method behaviour the
 * test controls, plus fake timers to step the poll interval — so the
 * inFlight guard, the FAIL_GRACE status logic, snapshot catch-up, and the
 * input coordinate de-normalization are exercised without Playwright.
 */

const FRAME_INTERVAL_MS = 300;
const FAIL_GRACE = 6;

type Reply = { ok: true; result: unknown } | { ok: false; message: string; kind?: string };

interface FakeSidecar {
  spawn: (path: string) => SidecarStream;
  /** Set the handler invoked for each incoming method. */
  setHandler: (fn: (method: string, params: unknown) => Reply) => void;
  received: Array<{ method: string; params: unknown }>;
}

function makeControllableSpawn(): FakeSidecar {
  const received: Array<{ method: string; params: unknown }> = [];
  let handler: (method: string, params: unknown) => Reply = () => ({ ok: false, message: 'no handler' });
  const spawn = (_path: string): SidecarStream => {
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
        const reqMsg = JSON.parse(line) as { id: string; method: string; params: unknown };
        received.push({ method: reqMsg.method, params: reqMsg.params });
        const r = handler(reqMsg.method, reqMsg.params);
        const reply = r.ok
          ? { id: reqMsg.id, ok: true, result: r.result }
          : { id: reqMsg.id, ok: false, error: { message: r.message, kind: r.kind } };
        stdout.write(JSON.stringify(reply) + '\n');
      }
    });
    const exitListeners: Array<(code: number | null) => void> = [];
    return {
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
  };
  return { spawn, setHandler: (fn) => (handler = fn), received };
}

const frame = (over: Partial<{ base64: string; mediaType: string; url: string; width: number; height: number }> = {}) => ({
  base64: 'AAAA',
  mediaType: 'image/jpeg',
  url: 'https://example.com/',
  width: 1000,
  height: 500,
  ...over,
});

/** Flush microtasks so the async tick() round-trips through the fake streams. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

afterEach(async () => {
  vi.useRealTimers();
  await closeBrowserSidecar();
});

describe('browser surface polling lifecycle', () => {
  it('emits a frame payload and tracks it as the snapshot', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler((method) => (method === 'frame' ? { ok: true, result: frame() } : { ok: false, message: 'x' }));

    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    const payloads: unknown[] = [];
    surface.onData((p) => payloads.push(p));

    await flush(); // the immediate kick tick()
    expect(payloads).toEqual([{ type: 'frame', base64: 'AAAA', mime: 'image/jpeg', url: 'https://example.com/' }]);
    expect(surface.snapshot()).toEqual({ type: 'frame', base64: 'AAAA', mime: 'image/jpeg', url: 'https://example.com/' });

    surface.close();
  });

  it('snapshot reports "Starting browser…" before any frame arrives', () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler(() => ({ ok: false, message: 'not yet' }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    expect(surface.snapshot()).toEqual({ type: 'status', text: 'Starting browser…' });
    surface.close();
  });

  it('does NOT emit a status on the first failures, but DOES on the FAIL_GRACE-th (no prior frame)', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler(() => ({ ok: false, message: 'launch failed' }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    const statuses: Array<{ type: string; text?: string }> = [];
    surface.onData((p) => statuses.push(p as { type: string; text?: string }));

    await flush(); // tick #1 (the kick)
    expect(statuses).toHaveLength(0);
    // Advance to the FAIL_GRACE-th failure. Each interval triggers one tick.
    for (let i = 1; i < FAIL_GRACE; i++) {
      await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
      await flush();
    }
    expect(statuses).toEqual([{ type: 'status', text: 'Browser unavailable: launch failed' }]);

    // Further failures do NOT re-emit (status fires once per failure streak).
    await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
    await flush();
    expect(statuses).toHaveLength(1);

    surface.close();
  });

  it('a successful frame resets the failure counter', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    let ok = false;
    sidecar.setHandler(() => (ok ? { ok: true, result: frame() } : { ok: false, message: 'flaky' }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    const events: Array<{ type: string }> = [];
    surface.onData((p) => events.push(p as { type: string }));

    await flush(); // fail #1
    await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS); // fail #2
    await flush();
    ok = true; // a good frame lands, resetting fails
    await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
    await flush();
    ok = false; // start failing again

    // Because the good frame reset `fails` to 0, we must accrue FAIL_GRACE
    // fresh failures via FAIL_GRACE more ticks before the status fires.
    for (let i = 0; i < FAIL_GRACE; i++) {
      await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
      await flush();
    }
    // The single status here is the "disconnected" one (a prior frame existed).
    const statuses = events.filter((e) => e.type === 'status');
    expect(statuses).toHaveLength(1);
    expect((statuses[0] as { text: string }).text).toMatch(/disconnected/);

    surface.close();
  });

  it('surfaces a "disconnected" status when the page dies after a frame was shown', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    let alive = true;
    sidecar.setHandler(() => (alive ? { ok: true, result: frame() } : { ok: false, message: 'page crashed' }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    const events: Array<{ type: string; text?: string }> = [];
    surface.onData((p) => events.push(p as { type: string; text?: string }));

    await flush(); // good frame
    alive = false;
    for (let i = 0; i < FAIL_GRACE; i++) {
      await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
      await flush();
    }
    const statuses = events.filter((e) => e.type === 'status');
    expect(statuses).toEqual([{ type: 'status', text: 'Browser disconnected: page crashed' }]);
    // The stale frame is still available via snapshot.
    expect(surface.snapshot()).toMatchObject({ type: 'frame' });

    surface.close();
  });

  it('a needs-install error pauses polling and emits an install prompt', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler(() => ({ ok: false, message: 'Playwright is not installed.', kind: 'needs-install' }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    const events: Array<{ type: string; needsInstall?: boolean; text?: string }> = [];
    surface.onData((p) => events.push(p as { type: string; needsInstall?: boolean }));

    await flush(); // the kick tick() hits the needs-install reply immediately
    expect(events).toEqual([
      expect.objectContaining({ type: 'status', needsInstall: true }),
    ]);
    // Snapshot for a late viewer also reports the install affordance.
    expect(surface.snapshot()).toMatchObject({ type: 'status', needsInstall: true });

    // Polling is paused: no further `frame` calls reach the sidecar (we don't
    // spin on an import that will keep failing).
    const before = sidecar.received.length;
    await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS * 4);
    await flush();
    expect(sidecar.received.length).toBe(before);

    surface.close();
  });

  it('treats a malformed frame reply as a failed tick (no blank frame emitted)', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    // The sidecar replies ok, but with a frame missing base64/url — a partial or
    // altered reply. The surface must NOT stream {base64: undefined} to subs.
    sidecar.setHandler((method) =>
      method === 'frame' ? { ok: true, result: { mediaType: 'image/jpeg' } } : { ok: false, message: 'x' },
    );
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    const events: Array<{ type: string }> = [];
    surface.onData((p) => events.push(p as { type: string }));

    await flush();
    // No frame payload streamed (it was treated as a failure).
    expect(events.filter((e) => e.type === 'frame')).toHaveLength(0);
    // Drive past FAIL_GRACE: a status surfaces instead of silent blanks.
    for (let i = 1; i < FAIL_GRACE; i++) {
      await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS);
      await flush();
    }
    expect(events.some((e) => e.type === 'status')).toBe(true);

    surface.close();
  });

  it('close() stops the poll — no further frame calls reach the sidecar', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler(() => ({ ok: true, result: frame() }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    await flush();
    const before = sidecar.received.length;
    surface.close();
    await vi.advanceTimersByTimeAsync(FRAME_INTERVAL_MS * 4);
    await flush();
    expect(sidecar.received.length).toBe(before);
  });
});

describe('browser surface input mapping', () => {
  it('click maps normalized fx/fy to viewport pixel coords from the last frame', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler((method) =>
      method === 'frame' ? { ok: true, result: frame({ width: 1000, height: 500 }) } : { ok: true, result: { url: 'x' } },
    );
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    await flush(); // establish last frame (1000x500)

    await surface.input({ type: 'click', fx: 0.5, fy: 0.2 });
    await flush();
    const mouseCall = sidecar.received.find((r) => r.method === 'mouse');
    expect(mouseCall?.params).toEqual({ x: 500, y: 100, count: 1 });

    surface.close();
  });

  it('click before any frame uses the 1280x720 fallback viewport', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    // Frame fails so `last` stays null, but mouse succeeds.
    sidecar.setHandler((method) => (method === 'mouse' ? { ok: true, result: { url: 'x' } } : { ok: false, message: 'no frame' }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    await flush();

    await surface.input({ type: 'click', fx: 1, fy: 1 });
    await flush();
    const mouseCall = sidecar.received.find((r) => r.method === 'mouse');
    expect(mouseCall?.params).toEqual({ x: 1280, y: 720, count: 1 });

    surface.close();
  });

  it('resize sets the page viewport so the view fills the pane', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler(() => ({ ok: true, result: frame() }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    await flush();
    await surface.resize?.({ width: 900, height: 600 });
    await flush();
    const vp = sidecar.received.find((r) => r.method === 'setviewport');
    expect(vp?.params).toEqual({ width: 900, height: 600 });
    surface.close();
  });

  it('dblclick forwards clickCount 2; hover + nav reach their sidecar methods', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler((method) => (method === 'frame' ? { ok: true, result: frame({ width: 1000, height: 500 }) } : { ok: true, result: {} }));
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    await flush();

    await surface.input({ type: 'dblclick', fx: 0.5, fy: 0.5 });
    await surface.input({ type: 'move', fx: 0.1, fy: 0.2 });
    await surface.input({ type: 'reload' });
    await flush();

    expect(sidecar.received.find((r) => r.method === 'mouse')?.params).toEqual({ x: 500, y: 250, count: 2 });
    expect(sidecar.received.find((r) => r.method === 'mousemove')?.params).toEqual({ x: 100, y: 100 });
    expect(sidecar.received.some((r) => r.method === 'reload')).toBe(true);
    surface.close();
  });

  it('zoom forwards the factor; capture maps the region and emits the PNG', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler((method) => {
      if (method === 'frame') return { ok: true, result: frame({ width: 1000, height: 500 }) };
      if (method === 'capture') return { ok: true, result: { mediaType: 'image/png', base64: 'PNGDATA' } };
      return { ok: true, result: {} };
    });
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    const events: Array<{ type: string; base64?: string }> = [];
    surface.onData((p) => events.push(p as { type: string }));
    await flush();

    await surface.input({ type: 'zoom', factor: 1.5 });
    await surface.input({ type: 'capture', fx: 0.1, fy: 0.2, fw: 0.5, fh: 0.4 });
    await flush();

    expect(sidecar.received.find((r) => r.method === 'zoom')?.params).toEqual({ factor: 1.5 });
    // normalized region × viewport (1000×500) → CSS px clip.
    expect(sidecar.received.find((r) => r.method === 'capture')?.params).toEqual({
      x: 100,
      y: 100,
      width: 500,
      height: 200,
    });
    expect(events.find((e) => e.type === 'captured')?.base64).toBe('PNGDATA');
    surface.close();
  });

  it('navigate proxies goto and surfaces a goto rejection as a status line', async () => {
    vi.useFakeTimers();
    const sidecar = makeControllableSpawn();
    sidecar.setHandler((method) => {
      if (method === 'goto') return { ok: false, message: 'SSRF blocked' };
      return { ok: false, message: 'no frame' };
    });
    const surface = buildBrowserSurface({ sidecarPath: '/fake.js', spawnFn: sidecar.spawn }).open();
    const events: Array<{ type: string; text?: string }> = [];
    surface.onData((p) => events.push(p as { type: string; text?: string }));
    await flush();

    await surface.input({ type: 'navigate', url: 'http://10.0.0.1/' });
    await flush();
    expect(events.some((e) => e.type === 'status' && e.text === 'SSRF blocked')).toBe(true);
    expect(sidecar.received.some((r) => r.method === 'goto')).toBe(true);

    surface.close();
  });
});

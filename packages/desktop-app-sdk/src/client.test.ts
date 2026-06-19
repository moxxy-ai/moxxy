import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectMoxxyApp, type MoxxyApp } from './client';
import { BRIDGE_TAG } from './bridge';
import type { AppPermission } from './permissions';

/**
 * The client only ever touches `window` (the one DOM-coupled file in the SDK).
 * The repo's vitest preset runs under the `node` environment with no jsdom, so
 * we stand up a minimal fake `window`/parent and synthesise `message` events to
 * drive the host<->app handshake. This exercises the worst-case paths the
 * hardening covers: a forged sender frame is dropped, a call that never gets a
 * response is bounded by a timeout (and its pending entry reclaimed), a
 * malformed response never surfaces `Error(undefined)`, and `disconnect()`
 * tears the listener down + rejects everything in flight.
 */

type Listener = (e: MessageEvent) => void;

interface FakeWindow {
  parent: unknown;
  addEventListener(type: 'message', fn: Listener): void;
  removeEventListener(type: 'message', fn: Listener): void;
  listeners: Set<Listener>;
}

let win: FakeWindow;
let parent: { postMessage: ReturnType<typeof vi.fn> };

/** Dispatch a synthetic `message` to every registered listener. `source`
 *  defaults to the host parent (the legitimate frame). */
function dispatch(data: unknown, source: unknown = parent): void {
  const event = { data, source } as unknown as MessageEvent;
  for (const fn of [...win.listeners]) fn(event);
}

function ready(permissions: AppPermission[], source: unknown = parent): void {
  dispatch({ __moxxy: BRIDGE_TAG, kind: 'ready', permissions }, source);
}

beforeEach(() => {
  parent = { postMessage: vi.fn() };
  const listeners = new Set<Listener>();
  win = {
    parent,
    listeners,
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
  };
  (globalThis as { window?: unknown }).window = win;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

describe('connectMoxxyApp handshake', () => {
  it('rejects when not running inside a host (no distinct parent)', async () => {
    win.parent = win; // top-level: parent === window
    await expect(connectMoxxyApp()).rejects.toThrow(/not running inside/);
  });

  it('resolves on the host ready handshake with the granted permissions', async () => {
    const p = connectMoxxyApp();
    ready(['documents.open']);
    const app = await p;
    expect(app.permissions).toEqual(['documents.open']);
  });

  it('times out when no host responds', async () => {
    vi.useFakeTimers();
    const p = connectMoxxyApp({ timeoutMs: 1000 });
    const assertion = expect(p).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(win.listeners.size).toBe(0); // listener removed on timeout
  });
});

describe('sender-frame isolation', () => {
  it('ignores a forged ready from a non-parent frame', async () => {
    vi.useFakeTimers();
    const p = connectMoxxyApp({ timeoutMs: 1000 });
    // A hostile nested iframe / window.opener posts a forged ready granting
    // itself everything — must be dropped, leaving the connect to time out.
    ready(['documents.open', 'documents.save', 'session.send'], { not: 'the parent' });
    const assertion = expect(p).rejects.toThrow(/did not respond/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('ignores a forged response from a non-parent frame', async () => {
    const connect = connectMoxxyApp({ callTimeoutMs: 60_000 });
    ready(['documents.open']);
    const app = await connect;

    const call = app.openDocument();
    // Forged response from an alien frame must NOT resolve the pending call.
    dispatch({ __moxxy: BRIDGE_TAG, kind: 'response', id: 1, ok: true, result: { text: 'evil', name: 'x' } }, {
      alien: true,
    });
    let settled = false;
    void call.then(() => (settled = true)).catch(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    // The genuine response from the real parent still settles it.
    dispatch({ __moxxy: BRIDGE_TAG, kind: 'response', id: 1, ok: true, result: { text: 'ok', name: 'd' } });
    await expect(call).resolves.toEqual({ text: 'ok', name: 'd' });
  });
});

describe('call permission + timeout + malformed responses', () => {
  it('fails fast on an ungranted method without a round-trip', async () => {
    const app = await connectGranted([]);
    await expect(app.openDocument()).rejects.toThrow(/not permitted/);
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('times out a call the host never answers and reclaims the pending entry', async () => {
    vi.useFakeTimers();
    const app = await connectGranted(['documents.open']);
    const call = app.openDocument();
    const assertion = expect(call).rejects.toThrow(/timed out after 50ms/);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    // A late response for the timed-out id is a no-op (no unhandled rejection,
    // no double-settle): nothing throws.
    dispatch({ __moxxy: BRIDGE_TAG, kind: 'response', id: 1, ok: true, result: null });
  });

  it('rejects a malformed response with a stable message, never Error(undefined)', async () => {
    const app = await connectGranted(['documents.open']);
    const call = app.openDocument();
    // ok is missing and there is no error string.
    dispatch({ __moxxy: BRIDGE_TAG, kind: 'response', id: 1, result: 'nope' });
    await expect(call).rejects.toThrow('bridge call failed');
  });

  it('surfaces the host error string when present', async () => {
    const app = await connectGranted(['documents.open']);
    const call = app.openDocument();
    dispatch({ __moxxy: BRIDGE_TAG, kind: 'response', id: 1, ok: false, error: 'boom' });
    await expect(call).rejects.toThrow('boom');
  });
});

describe('disconnect teardown', () => {
  it('removes the listener and rejects in-flight calls', async () => {
    const app = await connectGranted(['documents.open']);
    const call = app.openDocument();
    expect(win.listeners.size).toBe(1);
    app.disconnect();
    expect(win.listeners.size).toBe(0);
    await expect(call).rejects.toThrow(/disconnected/);
    // Further calls reject immediately, and disconnect is idempotent.
    await expect(app.openDocument()).rejects.toThrow(/disconnected/);
    expect(() => app.disconnect()).not.toThrow();
  });
});

/** Connect and resolve the ready handshake granting `permissions`. Uses a small
 *  `callTimeoutMs` so timeout assertions don't wait the 30s default. */
async function connectGranted(permissions: AppPermission[]): Promise<MoxxyApp> {
  const p = connectMoxxyApp({ callTimeoutMs: 50 });
  ready(permissions);
  return p;
}

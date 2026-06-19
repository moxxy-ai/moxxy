import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ClientSession, MoxxyEvent } from '@moxxy/sdk';
import { freeTcpPortIfMoxxy, WebChannel, type FreePortDeps } from './channel.js';
import type { ServerFrame } from './protocol.js';
import type { TunnelProviderDef } from '@moxxy/sdk';

const sampleDoc = { root: { kind: 'element', tag: 'view', props: { title: 'hi' }, children: [] } };

/** A fake session whose log fires real listeners and whose runTurn emits a present_view result. */
function fakeSession() {
  const listeners = new Set<(e: MoxxyEvent) => void>();
  const emit = (e: Record<string, unknown>) => {
    const ev = { turnId: 't1', sessionId: 's1', source: 'system', id: 'e', seq: 0, ts: 0, ...e } as unknown as MoxxyEvent;
    for (const fn of listeners) fn(ev);
  };
  const prompts: string[] = [];
  const session = {
    log: { subscribe: (fn: (e: MoxxyEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn); } },
    async *runTurn(prompt: string) {
      prompts.push(prompt);
      emit({ type: 'tool_call_requested', callId: 'c1', name: 'present_view', input: {} });
      emit({ type: 'tool_result', callId: 'c1', ok: true, output: { ast: sampleDoc } });
      emit({ type: 'assistant_message', content: 'here you go', stopReason: 'end_turn' });
    },
  } as unknown as ClientSession;
  return { session, prompts, emit };
}

let channel: WebChannel | null = null;
let handle: { stop: () => Promise<void> } | null = null;
afterEach(async () => {
  await handle?.stop();
  channel = null;
  handle = null;
});

async function startOn(session: ClientSession, token = 'tkn') {
  channel = new WebChannel({ port: 0, host: '127.0.0.1', authToken: token });
  handle = await channel.start({ session });
  const u = new URL(channel.url);
  return { base: `http://127.0.0.1:${u.port}`, wsBase: `ws://127.0.0.1:${u.port}`, token };
}

/** Open a ws and buffer every inbound frame from the moment it connects. */
async function connect(wsBase: string, token: string): Promise<{ ws: WebSocket; frames: ServerFrame[]; waitFor: (kind: ServerFrame['kind']) => Promise<ServerFrame> }> {
  const ws = new WebSocket(`${wsBase}/ws?t=${token}`);
  const frames: ServerFrame[] = [];
  ws.on('message', (d) => frames.push(JSON.parse(String(d)) as ServerFrame));
  await new Promise((r) => ws.once('open', r));
  const waitFor = (kind: ServerFrame['kind']) =>
    new Promise<ServerFrame>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const hit = frames.find((f) => f.kind === kind);
        if (hit) return resolve(hit);
        if (Date.now() - start > 2000) return reject(new Error(`no ${kind} frame`));
        setTimeout(tick, 10);
      };
      tick();
    });
  return { ws, frames, waitFor };
}

describe('WebChannel', () => {
  it('serves health and rejects untokened index', async () => {
    const { base } = await startOn(fakeSession().session);
    const health = await fetch(`${base}/v1/health`);
    expect(health.status).toBe(200);
    const noTok = await fetch(`${base}/`);
    expect(noTok.status).toBe(401);
  });

  it('rejects a WS handshake with a bad token (never opens)', async () => {
    const { wsBase } = await startOn(fakeSession().session);
    const ws = new WebSocket(`${wsBase}/ws?t=wrong`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      ws.on('unexpected-response', () => resolve(false));
    });
    expect(opened).toBe(false);
  });

  it('accepts a good token and sends hello', async () => {
    const { wsBase, token } = await startOn(fakeSession().session);
    const { ws, waitFor } = await connect(wsBase, token);
    expect((await waitFor('hello')).kind).toBe('hello');
    ws.close();
  });

  it('drives a turn from a prompt and pushes a view frame', async () => {
    const { session, prompts } = fakeSession();
    const { wsBase, token } = await startOn(session);
    const { ws, frames, waitFor } = await connect(wsBase, token);
    ws.send(JSON.stringify({ kind: 'prompt', text: 'find flights' }));
    await waitFor('view');
    expect(prompts).toEqual(['find flights']);
    expect(frames.some((f) => f.kind === 'message' && f.role === 'assistant')).toBe(true);
    ws.close();
  });

  it('translates a view action into a [ui-action] turn', async () => {
    const { session, prompts } = fakeSession();
    const { wsBase, token } = await startOn(session);
    const { ws, waitFor } = await connect(wsBase, token);
    ws.send(JSON.stringify({ kind: 'action', actionId: 'a1', viewId: null, action: { name: 'search_flights' }, formValues: { from: 'SFO' } }));
    await waitFor('ack');
    await waitFor('view');
    expect(prompts[0]).toContain('[ui-action]');
    expect(prompts[0]).toContain('search_flights');
    expect(prompts[0]).toContain('SFO');
    ws.close();
  });

  it('mirrors a foreign turn — pushes a view for events it did not initiate', async () => {
    // Simulates a turn driven elsewhere (e.g. a Telegram message on a shared
    // session): the web surface renders it purely from the log subscription.
    const { session, emit, prompts } = fakeSession();
    const { wsBase, token } = await startOn(session);
    const { ws, waitFor } = await connect(wsBase, token);
    emit({ type: 'tool_call_requested', callId: 'fc', name: 'present_view', input: {} });
    emit({ type: 'tool_result', callId: 'fc', ok: true, output: { ast: sampleDoc } });
    const view = await waitFor('view');
    expect(view.kind).toBe('view');
    expect(prompts).toEqual([]); // the web channel drove nothing
    ws.close();
  });

  it('replays already-built views to a browser that connects later', async () => {
    const { session, emit } = fakeSession();
    const { wsBase, token } = await startOn(session);
    // Build a view BEFORE any browser connects (the normal flow: build in TUI,
    // then open the link).
    emit({ type: 'tool_call_requested', callId: 'c', name: 'present_view', input: {} });
    emit({
      type: 'tool_result',
      callId: 'c',
      ok: true,
      output: { ast: { root: { kind: 'element', tag: 'view', props: { name: 'search' }, children: [] } } },
    });
    // Now connect — the view must arrive via replay (no "No view yet").
    const { ws, waitFor } = await connect(wsBase, token);
    const v = await waitFor('view');
    expect(v.kind).toBe('view');
    ws.close();
  });

  it('publishes the surface URL via the active tunnel provider', async () => {
    let published: { url: string; nextViewId: () => string } | null = null;
    const fakeTunnel: TunnelProviderDef = {
      name: 'fake',
      open: () => Promise.resolve({ url: 'https://abc.trycloudflare.com', close: () => Promise.resolve() }),
    };
    channel = new WebChannel({
      port: 0,
      host: '127.0.0.1',
      authToken: 'tkn',
      getTunnel: () => fakeTunnel,
      publishSurface: (s) => {
        published = s;
      },
    });
    handle = await channel.start({ session: fakeSession().session });
    expect(published).not.toBeNull();
    expect(published!.url).toBe('https://abc.trycloudflare.com/?t=tkn');
  });

  it('co-attached to a real Session publishes a localhost URL by default (the TUI case)', async () => {
    const { Session } = await import('@moxxy/core');
    const session = new Session({ cwd: '/tmp', silent: true });
    let published: { url: string; nextViewId: () => string } | null = null;
    channel = new WebChannel({
      port: 0,
      host: '127.0.0.1',
      authToken: 'tkn',
      getTunnel: () => session.tunnelProviders.getActive(), // core seeds 'localhost'
      publishSurface: (s) => {
        published = s;
      },
    });
    handle = await channel.start({ session: session as never });
    expect(published).not.toBeNull();
    // A real, tokenized URL present_view can hand back — never null/rendered:false.
    expect(published!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=tkn$/);
  });

  it('falls back to the local URL when the tunnel provider fails', async () => {
    let published: { url: string; nextViewId: () => string } | null = null;
    const badTunnel: TunnelProviderDef = {
      name: 'bad',
      open: () => Promise.reject(new Error('cloudflared not installed')),
    };
    channel = new WebChannel({
      port: 0,
      host: '127.0.0.1',
      authToken: 'tkn',
      getTunnel: () => badTunnel,
      publishSurface: (s) => {
        published = s;
      },
    });
    handle = await channel.start({ session: fakeSession().session });
    expect(published).not.toBeNull();
    expect(published!.url).toContain('http://127.0.0.1:');
    expect(published!.url).toContain('?t=tkn');
  });

  it('rejects a view action while a turn is in flight (busy)', async () => {
    // A runTurn that never resolves until released, so the channel stays busy.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const session = {
      log: { subscribe: () => () => undefined },
      async *runTurn() {
        await gate;
      },
    } as unknown as Parameters<WebChannel['start']>[0]['session'];
    const { wsBase, token } = await startOn(session as never);
    const { ws, waitFor, frames } = await connect(wsBase, token);
    ws.send(JSON.stringify({ kind: 'prompt', text: 'go' })); // occupies the channel
    ws.send(JSON.stringify({ kind: 'action', actionId: 'a2', viewId: null, action: { name: 'x' }, formValues: {} }));
    const ack = await waitFor('ack');
    expect(ack.kind === 'ack' && ack.accepted).toBe(false);
    expect(frames.some((f) => f.kind === 'ack' && !f.accepted && f.reason === 'busy')).toBe(true);
    release();
    ws.close();
  });

  it('ignores malformed JSON without crashing', async () => {
    const { session } = fakeSession();
    const { wsBase, token } = await startOn(session);
    const { ws, waitFor } = await connect(wsBase, token);
    ws.send('not json{{{');
    // Still responsive afterwards.
    ws.send(JSON.stringify({ kind: 'prompt', text: 'find flights' }));
    await waitFor('view');
    ws.close();
  });

  it('drops schema-invalid frames (no throw, no turn driven) and stays responsive', async () => {
    const { session, prompts } = fakeSession();
    const { wsBase, token } = await startOn(session);
    const { ws, waitFor } = await connect(wsBase, token);
    // The historical crasher: valid JSON, missing required field →
    // `frame.text.trim()` threw inside the ws 'message' listener and the
    // TypeError escalated to a process-level uncaughtException.
    ws.send(JSON.stringify({ kind: 'prompt' }));
    ws.send(JSON.stringify({ kind: 'action' })); // no actionId/action/formValues
    ws.send(JSON.stringify({ kind: 'action', actionId: 'a', viewId: null, formValues: {} })); // no action
    ws.send(JSON.stringify({ kind: 'prompt', text: 42 })); // wrong field type
    ws.send(JSON.stringify({ kind: 'nonsense' })); // unknown kind
    ws.send(JSON.stringify({})); // no kind at all
    ws.send('junk{{{'); // not JSON
    ws.send('"' + 'x'.repeat(300 * 1024) + '"'); // oversized garbage (> MAX_FRAME_BYTES)
    // Same socket, valid frame: the channel must still be alive + responsive,
    // and none of the invalid frames may have driven a turn.
    ws.send(JSON.stringify({ kind: 'prompt', text: 'still alive' }));
    await waitFor('view');
    expect(prompts).toEqual(['still alive']);
    ws.close();
  });

  it('rate-limits the invalid-frame warn log', async () => {
    const warns: string[] = [];
    const { session } = fakeSession();
    channel = new WebChannel({
      port: 0,
      host: '127.0.0.1',
      authToken: 'tkn',
      logger: { warn: (msg) => warns.push(msg) },
    });
    handle = await channel.start({ session });
    const u = new URL(channel.url);
    const { ws, waitFor } = await connect(`ws://127.0.0.1:${u.port}`, 'tkn');
    for (let i = 0; i < 25; i++) ws.send(JSON.stringify({ kind: 'prompt' }));
    ws.send(JSON.stringify({ kind: 'prompt', text: 'go' }));
    await waitFor('view');
    expect(warns.filter((m) => m.includes('dropped invalid client frame'))).toHaveLength(1);
    ws.close();
  });

  it('falls back to an ephemeral port when a non-moxxy process holds its port', async () => {
    // Occupy a port with a server owned by THIS (non-target) process — the
    // channel must not signal anything and must bind an ephemeral port.
    const { createServer } = await import('node:http');
    const squatter = createServer(() => undefined);
    await new Promise<void>((resolve) => squatter.listen(0, '127.0.0.1', resolve));
    const taken = (squatter.address() as { port: number }).port;
    const warns: string[] = [];
    try {
      channel = new WebChannel({
        port: taken,
        host: '127.0.0.1',
        authToken: 'tkn',
        logger: { warn: (msg) => warns.push(msg) },
      });
      handle = await channel.start({ session: fakeSession().session });
      const bound = Number(new URL(channel.url).port);
      expect(bound).not.toBe(taken);
      expect(bound).toBeGreaterThan(0);
      // The squatter survived (no kill) …
      expect(squatter.listening).toBe(true);
      // … the fallback was logged loudly …
      expect(warns.some((m) => m.includes(`bound ephemeral port ${bound}`))).toBe(true);
      // … and the channel actually works on the fallback port.
      const health = await fetch(`http://127.0.0.1:${bound}/v1/health`);
      expect(health.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });

  it('broadcasts a view to multiple connected clients', async () => {
    const { session, emit } = fakeSession();
    const { wsBase, token } = await startOn(session);
    const c1 = await connect(wsBase, token);
    const c2 = await connect(wsBase, token);
    emit({ type: 'tool_call_requested', callId: 'm', name: 'present_view', input: {} });
    emit({ type: 'tool_result', callId: 'm', ok: true, output: { ast: sampleDoc } });
    await c1.waitFor('view');
    await c2.waitFor('view');
    c1.ws.close();
    c2.ws.close();
  });

  it('serves 404 for unknown routes', async () => {
    const { base } = await startOn(fakeSession().session);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('emits defense-in-depth security headers on the index response', async () => {
    // The headers are unconditional on the index path: they ride the 200 with
    // the bundle present and the 500 when it's missing (the case under vitest,
    // which runs from src/ with no built dist/public), so a missing bundle never
    // serves a page without the clickjacking / referrer-token protections.
    const { base, token } = await startOn(fakeSession().session);
    const res = await fetch(`${base}/?t=${token}`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('bounds the replay set: an unbounded stream of unnamed views collapses to one', async () => {
    // A pathological agent that presents many UNNAMED views must not leak one
    // ViewDoc per render, and a late joiner must not receive the whole history.
    const { session, emit } = fakeSession();
    const { wsBase, token } = await startOn(session);
    for (let i = 0; i < 200; i++) {
      emit({ type: 'tool_call_requested', callId: `u${i}`, name: 'present_view', input: {} });
      emit({ type: 'tool_result', callId: `u${i}`, ok: true, output: { ast: sampleDoc } });
    }
    const { ws, frames, waitFor } = await connect(wsBase, token);
    await waitFor('view');
    // Give replay a beat to flush, then assert the late joiner saw exactly ONE
    // replayed view, not 200.
    await new Promise((r) => setTimeout(r, 50));
    expect(frames.filter((f) => f.kind === 'view')).toHaveLength(1);
    ws.close();
  });

  it('bounds the replay set across many distinct NAMED views (LRU-capped)', async () => {
    const { session, emit } = fakeSession();
    const { wsBase, token } = await startOn(session);
    for (let i = 0; i < 100; i++) {
      emit({ type: 'tool_call_requested', callId: `n${i}`, name: 'present_view', input: {} });
      emit({
        type: 'tool_result',
        callId: `n${i}`,
        ok: true,
        output: { ast: { root: { kind: 'element', tag: 'view', props: { name: `screen${i}` }, children: [] } } },
      });
    }
    const { ws, frames, waitFor } = await connect(wsBase, token);
    await waitFor('view');
    await new Promise((r) => setTimeout(r, 50));
    // 100 distinct named screens were built, but replay is capped at 32.
    expect(frames.filter((f) => f.kind === 'view').length).toBeLessThanOrEqual(32);
    ws.close();
  });

  it('clears the published surface on stop', async () => {
    let published: { url: string; nextViewId: () => string } | null = { url: 'stale', nextViewId: () => 'x' };
    channel = new WebChannel({
      port: 0,
      host: '127.0.0.1',
      authToken: 'tkn',
      publishSurface: (s) => {
        published = s;
      },
    });
    handle = await channel.start({ session: fakeSession().session });
    expect(published).not.toBeNull();
    await handle.stop();
    handle = null; // already stopped
    expect(published).toBeNull();
  });
});

describe.skipIf(process.platform === 'win32')('freeTcpPortIfMoxxy: identity-gate TOCTOU', () => {
  function mkDeps(over: Partial<FreePortDeps> & { commandsByPid: Record<number, string[]> }): {
    deps: FreePortDeps;
    killed: Array<{ pid: number; signal: number | NodeJS.Signals }>;
  } {
    const killed: Array<{ pid: number; signal: number | NodeJS.Signals }> = [];
    // Each PID gets a queue of commands returned on successive pidCommand reads,
    // so a PID can "change identity" between the snapshot and the kill.
    const calls: Record<number, number> = {};
    const deps: FreePortDeps = {
      pidsListeningOn: async () => Object.keys(over.commandsByPid).map(Number),
      pidCommand: async (pid) => {
        const seq = over.commandsByPid[pid] ?? [];
        const i = Math.min(calls[pid] ?? 0, seq.length - 1);
        calls[pid] = (calls[pid] ?? 0) + 1;
        return seq[i] ?? '';
      },
      kill: (pid, signal) => {
        killed.push({ pid, signal });
      },
      graceMs: 0,
      ...over,
    };
    return { deps, killed };
  }

  it('skips the kill when a moxxy PID is reused by a foreign process before SIGTERM', async () => {
    // 4242 passes the initial snapshot as moxxy, then its command flips to a
    // foreign process before the kill: it must NOT be signalled.
    const { deps, killed } = mkDeps({
      commandsByPid: { 4242: ['node /usr/local/bin/moxxy serve', '/usr/bin/postgres'] },
    });
    const result = await freeTcpPortIfMoxxy(4242, undefined, deps);
    expect(result).toBe(false);
    expect(killed).toEqual([]);
  });

  it('kills a PID that stays moxxy through the re-check (SIGTERM then SIGKILL)', async () => {
    // Stays moxxy on every read; still "alive" on the kill(pid,0) probe.
    const { deps, killed } = mkDeps({
      commandsByPid: { 5252: ['node moxxy serve', 'node moxxy serve', 'node moxxy serve'] },
    });
    const result = await freeTcpPortIfMoxxy(5252, undefined, deps);
    expect(result).toBe(true);
    expect(killed.map((k) => k.signal)).toEqual(['SIGTERM', 0, 'SIGKILL']);
  });

  it('leaves a foreign-from-the-start holder untouched', async () => {
    const { deps, killed } = mkDeps({
      commandsByPid: { 6262: ['/usr/sbin/sshd'] },
    });
    const result = await freeTcpPortIfMoxxy(6262, undefined, deps);
    expect(result).toBe(false);
    expect(killed).toEqual([]);
  });
});

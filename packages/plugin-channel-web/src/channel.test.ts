import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ClientSession, MoxxyEvent } from '@moxxy/sdk';
import { WebChannel } from './channel.js';
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

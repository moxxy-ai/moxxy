import { describe, it, expect, vi, afterEach } from 'vitest';
import { encodeIpcError } from '@moxxy/desktop-ipc-contract';
import {
  WsRpcClient,
  type WebSocketCtor,
  type WebSocketLike,
  type WsClientStatus,
  type WsRpcClientOptions,
} from './json-rpc-client.js';
import { makeWsApi } from './index.js';

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {}
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  lastReq(): { id: number; method: string; params?: unknown } {
    return JSON.parse(this.sent[this.sent.length - 1]!);
  }
}

function makeClient(opts: WsRpcClientOptions = {}): {
  client: WsRpcClient;
  socket: FakeSocket;
  instances: FakeSocket[];
} {
  const instances: FakeSocket[] = [];
  class CtorFake extends FakeSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols);
      instances.push(this);
    }
  }
  const client = new WsRpcClient('ws://x:1', CtorFake as unknown as WebSocketCtor, opts);
  client.connect();
  return { client, socket: instances[0]!, instances };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WsRpcClient', () => {
  it('queues a request until open, then resolves on the matching response', async () => {
    const { client, socket } = makeClient();
    const p = client.request('connection.activeWorkspace');
    expect(socket.sent.length).toBe(0); // queued while not open
    socket.open();
    expect(socket.sent.length).toBe(1);
    const req = socket.lastReq();
    expect(req.method).toBe('connection.activeWorkspace');
    socket.emit({ id: req.id, result: 'ws-1' });
    await expect(p).resolves.toBe('ws-1');
    client.close();
  });

  it('rejects with the re-encoded MoxxyIpcError envelope when data is present', async () => {
    const { client, socket } = makeClient();
    socket.open();
    const p = client.request('session.info', {});
    const req = socket.lastReq();
    const envelope = { code: 'not-connected', message: 'nope' };
    socket.emit({ id: req.id, error: { message: 'nope', data: envelope } });
    await expect(p).rejects.toThrow(encodeIpcError(envelope));
    client.close();
  });

  it('dispatches notifications to subscribers', () => {
    const { client, socket } = makeClient();
    socket.open();
    const got: unknown[] = [];
    const off = client.on('runner.turn.complete', (params) => got.push(params));
    socket.emit({ method: 'runner.turn.complete', params: { workspaceId: 'w', turnId: 't', error: null } });
    expect(got).toEqual([{ workspaceId: 'w', turnId: 't', error: null }]);
    off();
    socket.emit({ method: 'runner.turn.complete', params: { workspaceId: 'w2' } });
    expect(got.length).toBe(1); // unsubscribed
    client.close();
  });

  it('rejects in-flight requests when the link drops', async () => {
    const { client, socket } = makeClient();
    socket.open();
    const p = client.request('connection.activeWorkspace');
    socket.close();
    await expect(p).rejects.toThrow('connection closed');
    client.close();
  });

  it('rejects QUEUED requests on disconnect and never replays them after reconnect', async () => {
    vi.useFakeTimers();
    const { client, socket, instances } = makeClient();
    // Queued while connecting (never sent), then the link drops.
    const p = client.request('session.runTurn', { text: 'do something' });
    socket.close();
    await expect(p).rejects.toThrow('connection closed');

    // Reconnect: the abandoned runTurn must NOT be re-executed.
    vi.advanceTimersByTime(60_000);
    const next = instances[1]!;
    next.open();
    expect(next.sent).toEqual([]);
    client.close();
  });

  it('passes the requested subprotocols to the WebSocket constructor', () => {
    const { socket, client } = makeClient({ protocols: ['moxxy.v1', 'moxxy.bearer.abc'] });
    expect(socket.protocols).toEqual(['moxxy.v1', 'moxxy.bearer.abc']);
    client.close();
  });

  it('backs off, gives up after the attempt cap, and surfaces a terminal disconnect', async () => {
    vi.useFakeTimers();
    const statuses: WsClientStatus[] = [];
    const { client, instances } = makeClient({
      maxReconnectAttempts: 2,
      onStatus: (s) => statuses.push(s),
    });
    // Drop the link three times: two reconnect attempts, then terminal.
    instances[0]!.close();
    vi.advanceTimersByTime(60_000);
    expect(instances.length).toBe(2);
    instances[1]!.close();
    vi.advanceTimersByTime(60_000);
    expect(instances.length).toBe(3);
    instances[2]!.close();
    vi.advanceTimersByTime(600_000);
    expect(instances.length).toBe(3); // no further attempts

    expect(client.status).toBe('disconnected');
    expect(statuses).toContain('disconnected');
    await expect(client.request('connection.activeWorkspace')).rejects.toThrow(
      'transport disconnected',
    );
  });

  it('resets the reconnect budget after a successful open', () => {
    vi.useFakeTimers();
    const { client, instances } = makeClient({ maxReconnectAttempts: 1 });
    instances[0]!.close(); // attempt 1 scheduled
    vi.advanceTimersByTime(60_000);
    instances[1]!.open(); // success resets the budget
    instances[1]!.close(); // a fresh drop gets a fresh attempt
    vi.advanceTimersByTime(60_000);
    expect(instances.length).toBe(3);
    expect(client.status).not.toBe('disconnected');
    client.close();
  });
});

describe('makeWsApi', () => {
  it('presents the token via the Sec-WebSocket-Protocol bearer entry, not the URL', () => {
    const instances: FakeSocket[] = [];
    class CtorFake extends FakeSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        instances.push(this);
      }
    }
    makeWsApi({
      url: 'ws://host:8765',
      token: 'tok+en=1',
      WebSocket: CtorFake as unknown as WebSocketCtor,
    });
    const socket = instances[0]!;
    expect(socket.url).toBe('ws://host:8765'); // no ?t= in the URL
    expect(socket.protocols).toEqual(['moxxy.v1', 'moxxy.bearer.tok%2Ben%3D1']);
  });

  it('omits subprotocols when no token is configured', () => {
    const instances: FakeSocket[] = [];
    class CtorFake extends FakeSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        instances.push(this);
      }
    }
    makeWsApi({ url: 'ws://host:8765', WebSocket: CtorFake as unknown as WebSocketCtor });
    expect(instances[0]!.protocols).toBeUndefined();
  });
});

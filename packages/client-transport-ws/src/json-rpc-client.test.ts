import { describe, it, expect } from 'vitest';
import { encodeIpcError } from '@moxxy/desktop-ipc-contract';
import { WsRpcClient, type WebSocketCtor, type WebSocketLike } from './json-rpc-client.js';

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(public url: string) {}
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

function makeClient(): { client: WsRpcClient; socket: FakeSocket } {
  const instances: FakeSocket[] = [];
  class CtorFake extends FakeSocket {
    constructor(url: string) {
      super(url);
      instances.push(this);
    }
  }
  const client = new WsRpcClient('ws://x:1', CtorFake as unknown as WebSocketCtor);
  client.connect();
  return { client, socket: instances[0]! };
}

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
});

import { describe, it, expect } from 'vitest';
import { JsonRpcPeer, RpcError, type Transport } from '@moxxy/runner';
import { IpcError } from '@moxxy/desktop-ipc-contract/dispatch';
import { WebSocketCommandBus } from './ws-command-bus.js';

/** A pair of in-memory transports wired to each other (async delivery). */
function makeTransportPair(): [Transport, Transport] {
  let aFrame: ((f: unknown) => void) | null = null;
  let bFrame: ((f: unknown) => void) | null = null;
  let aClose: ((e?: Error) => void) | null = null;
  let bClose: ((e?: Error) => void) | null = null;
  const a: Transport = {
    send: (f) => queueMicrotask(() => bFrame?.(f)),
    onFrame: (h) => { aFrame = h; },
    onClose: (h) => { aClose = h; },
    close: () => { aClose?.(); bClose?.(); },
  };
  const b: Transport = {
    send: (f) => queueMicrotask(() => aFrame?.(f)),
    onFrame: (h) => { bFrame = h; },
    onClose: (h) => { bClose = h; },
    close: () => { aClose?.(); bClose?.(); },
  };
  return [a, b];
}

describe('WebSocketCommandBus', () => {
  it('round-trips a command through dispatch to the handler value', async () => {
    const bus = new WebSocketCommandBus();
    bus.handle('connection.activeWorkspace', async () => 'ws-9');
    const [server, client] = makeTransportPair();
    bus.attach(server);
    const peer = new JsonRpcPeer(client);
    await expect(peer.request('connection.activeWorkspace')).resolves.toBe('ws-9');
  });

  it('maps an IpcError to a JSON-RPC error carrying the coded envelope as data', async () => {
    const bus = new WebSocketCommandBus();
    bus.handle('session.info', async () => {
      throw new IpcError('not-connected', 'no runner');
    });
    const [server, client] = makeTransportPair();
    bus.attach(server);
    const peer = new JsonRpcPeer(client);
    await expect(peer.request('session.info', {})).rejects.toMatchObject({
      message: 'no runner',
      data: { code: 'not-connected', message: 'no runner' },
    });
  });

  it('refuses host-only commands over the remote transport', async () => {
    const bus = new WebSocketCommandBus();
    let ran = false;
    bus.handle('app.relaunch', async () => {
      ran = true;
    });
    const [server, client] = makeTransportPair();
    bus.attach(server);
    const peer = new JsonRpcPeer(client);
    const err = await peer.request('app.relaunch').then(
      () => null,
      (e: unknown) => e,
    );
    expect(ran).toBe(false);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).data).toMatchObject({ code: 'runner-error' });
  });

  it('broadcasts events as notifications to every open peer', async () => {
    const bus = new WebSocketCommandBus();
    const [server, client] = makeTransportPair();
    bus.attach(server);
    const peer = new JsonRpcPeer(client);
    const got: unknown[] = [];
    peer.on('runner.turn.complete', (params) => got.push(params));
    bus.broadcast('runner.turn.complete', { workspaceId: 'ws-1', turnId: 't1', error: null });
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect(got).toEqual([{ workspaceId: 'ws-1', turnId: 't1', error: null }]);
  });
});

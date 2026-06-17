import { describe, it, expect } from 'vitest';
import { JsonRpcPeer, RpcError, type Transport } from '@moxxy/runner';
import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
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

  describe('deny-by-default remote allow-list', () => {
    /** The host-mutating commands a paired phone (or a LAN attacker with the
     *  token) must NEVER reach over the WS bridge — even though the desktop wires
     *  ALL of them onto the same bus as the chat commands. */
    const HOST_MUTATING: ReadonlyArray<IpcCommandName> = [
      'desks.create',
      'desks.rename',
      'desks.remove',
      'onboarding.saveProviderKey',
      'onboarding.openExternal',
      'app.updateCli',
      'app.checkUpdate',
      'app.updateDashboard',
      'settings.vaultSet',
      'settings.vaultDelete',
      'prefs.update',
      // Workflow AUTHORING (write) + re-enable — read/run stays allowed.
      'workflows.save',
      'workflows.validateDraft',
      'workflows.setEnabled',
      // The gateway-control commands themselves.
      'mobileGateway.status',
      'mobileGateway.setEnabled',
      'mobileGateway.rotateToken',
    ];

    it.each(HOST_MUTATING)('REJECTS host-mutating command %s on the WS bus', async (command) => {
      const bus = new WebSocketCommandBus();
      let ran = false;
      // Register the handler exactly as the desktop's registerIpcHandlers would.
      bus.handle(command, (async () => {
        ran = true;
      }) as never);
      const [server, client] = makeTransportPair();
      bus.attach(server);
      const peer = new JsonRpcPeer(client);
      const err = await peer.request(command, {}).then(
        () => null,
        (e: unknown) => e,
      );
      expect(ran).toBe(false);
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).data).toMatchObject({ code: 'runner-error' });
      expect((err as RpcError).message).toMatch(/not available over a remote transport/);
    });

    /** The legitimate chat-driving commands a paired phone DOES need, paired
     *  with a VALID payload so the shared dispatch-core schema validation passes
     *  and we exercise the allow gate, not the validator. */
    const LEGIT_CHAT: ReadonlyArray<[IpcCommandName, unknown]> = [
      ['ask.respond', { requestId: 'r1', response: { mode: 'allow' } }],
      ['session.info', { workspaceId: 'ws-1' }],
      ['session.runTurn', { workspaceId: 'ws-1', prompt: 'hi' }],
      ['session.abortTurn', { workspaceId: 'ws-1', turnId: 't1' }],
      ['session.setMode', { workspaceId: 'ws-1', mode: 'default' }],
      ['session.setAutoApprove', { workspaceId: 'ws-1', enabled: true }],
      ['session.newSession', { workspaceId: 'ws-1' }],
      ['session.runCommand', { workspaceId: 'ws-1', name: 'compact', args: '' }],
      ['session.transcribe', { audioBase64: 'AA==' }],
      ['connection.snapshotAll', undefined],
      ['chat.append', { workspaceId: 'ws-1', events: [] }],
      ['chat.loadSegment', { workspaceId: 'ws-1', before: null, limit: 50 }],
      ['workflows.list', undefined],
      ['workflows.run', { name: 'wf-1' }],
      ['workflows.getRun', { name: 'wf-1' }],
      // Human-in-the-loop: answer a paused workflow's question (RESPOND-only).
      ['workflows.resume', { runId: 'run-1', reply: 'ship it' }],
    ];

    it.each(LEGIT_CHAT)('ALLOWS legit chat command %s on the WS bus', async (command, payload) => {
      const bus = new WebSocketCommandBus();
      bus.handle(command, (async () => 'ok') as never);
      const [server, client] = makeTransportPair();
      bus.attach(server);
      const peer = new JsonRpcPeer(client);
      await expect(peer.request(command, payload)).resolves.toBe('ok');
    });

    it('a self-curating host (allowedCommands: null) skips the allow-list', async () => {
      // The standalone `moxxy mobile` MobileSessionHost is its own trust surface.
      const bus = new WebSocketCommandBus({ allowedCommands: null });
      bus.handle('session.setAutoApprove', (async () => undefined) as never);
      const [server, client] = makeTransportPair();
      bus.attach(server);
      const peer = new JsonRpcPeer(client);
      await expect(peer.request('session.setAutoApprove', { enabled: true })).resolves.toBeNull();
    });
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

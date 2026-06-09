/**
 * The WebSocket implementation of {@link CommandBus} + {@link EventSink}.
 *
 * `handle` collects the per-domain command handlers into a method map (the same
 * registrar bodies the Electron bus sees). Each accepted connection gets a
 * {@link JsonRpcPeer}: every command is exposed as a JSON-RPC method that runs
 * through the shared {@link dispatch} core — so payload validation, error
 * classification, and the authz gates inside the handler bodies are identical to
 * the Electron path. Failures map to a JSON-RPC error whose `data` carries the
 * coded {@link MoxxyIpcError}; the client reconstructs it (the Electron string
 * envelope is never used on the wire).
 *
 * `broadcast` pushes an event as a JSON-RPC notification to every open peer —
 * the full `workspaceId`-tagged stream, exactly as the desktop renderer
 * receives it; clients route by tag.
 */

import { JsonRpcPeer, RpcError, type Transport } from '@moxxy/runner';

import type {
  IpcCommandName,
  IpcCommands,
  IpcEvents,
} from '@moxxy/desktop-ipc-contract';
import { REMOTE_DISALLOWED_COMMANDS } from '@moxxy/desktop-ipc-contract';
import type { CommandBus, EventSink } from '@moxxy/desktop-ipc-contract/bus';
import { dispatch } from '@moxxy/desktop-ipc-contract/dispatch';

type RegisteredHandler = (...args: never[]) => Promise<unknown>;

export class WebSocketCommandBus implements CommandBus, EventSink {
  private readonly methods = new Map<IpcCommandName, RegisteredHandler>();
  private readonly peers = new Set<JsonRpcPeer>();

  handle<K extends IpcCommandName>(
    channel: K,
    fn: (
      ...args: Parameters<IpcCommands[K]>
    ) => Promise<Awaited<ReturnType<IpcCommands[K]>>>,
  ): void {
    this.methods.set(channel, fn as unknown as RegisteredHandler);
  }

  /**
   * Wire a freshly-accepted transport: build a peer, expose every registered
   * command as a JSON-RPC method, and track it for event broadcast. Drops the
   * peer from the broadcast set when the link closes.
   */
  attach(transport: Transport): void {
    const peer = new JsonRpcPeer(transport);
    for (const [channel, fn] of this.methods) {
      peer.handle(channel, async (params) => {
        if (REMOTE_DISALLOWED_COMMANDS.has(channel)) {
          const message = `command "${channel}" is not available over a remote transport`;
          throw new RpcError(message, { code: 'runner-error', message });
        }
        // JSON-RPC carries the single command arg as `params` (or none).
        const args = (params === undefined ? [] : [params]) as Parameters<IpcCommands[typeof channel]>;
        const result = await dispatch(channel, args, fn as never);
        if (result.ok) return result.value;
        throw new RpcError(result.error.message, result.error);
      });
    }
    this.peers.add(peer);
    peer.onClose(() => {
      this.peers.delete(peer);
    });
  }

  broadcast<K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void {
    for (const peer of this.peers) {
      if (!peer.isClosed) peer.notify(channel, payload);
    }
  }
}

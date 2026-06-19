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
import { REMOTE_ALLOWED_COMMANDS } from '@moxxy/desktop-ipc-contract';
import type { CommandBus, EventSink } from '@moxxy/desktop-ipc-contract/bus';
import { dispatch } from '@moxxy/desktop-ipc-contract/dispatch';

type RegisteredHandler = (...args: never[]) => Promise<unknown>;

/** Options for {@link WebSocketCommandBus}. */
export interface WebSocketCommandBusOptions {
  /**
   * The allow-list of commands accepted over this remote transport. Defaults to
   * the contract's {@link REMOTE_ALLOWED_COMMANDS} — the desktop gateway wires
   * its COMPLETE IPC handler set onto the WS bus, so the allow-list is the only
   * thing standing between a paired phone and the host-mutating commands; it
   * must stay deny-by-default.
   *
   * Pass an explicit set ONLY for a host that already exposes a deliberately
   * curated subset on this bus (e.g. the standalone `moxxy mobile`
   * `MobileSessionHost`, which registers exactly one single-session command set
   * and so is its own trust surface). `null` disables the allow-list entirely —
   * reserved for the same self-curating-host case; never use it for a bus the
   * full desktop IPC handler set is registered on.
   */
  readonly allowedCommands?: ReadonlySet<IpcCommandName> | null;
}

export class WebSocketCommandBus implements CommandBus, EventSink {
  private readonly methods = new Map<IpcCommandName, RegisteredHandler>();
  private readonly peers = new Set<JsonRpcPeer>();
  /** The transport each live peer rides, so a double-attach of the same
   *  transport (which would clobber its single frame handler per the Transport
   *  contract) is ignored rather than silently creating a broken second peer. */
  private readonly attachedTransports = new Set<Transport>();
  /** Deny-by-default allow-list (null ⇒ no filter; see the constructor). */
  private readonly allowedCommands: ReadonlySet<IpcCommandName> | null;

  constructor(opts: WebSocketCommandBusOptions = {}) {
    this.allowedCommands =
      opts.allowedCommands === undefined ? REMOTE_ALLOWED_COMMANDS : opts.allowedCommands;
  }

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
    // Re-attaching the same transport would create a second JsonRpcPeer that
    // clobbers the first's frame handler (Transport allows one handler), leaving
    // a half-dead duplicate in the broadcast set. Ignore the redundant attach.
    if (this.attachedTransports.has(transport)) return;
    this.attachedTransports.add(transport);
    const peer = new JsonRpcPeer(transport);
    for (const [channel, fn] of this.methods) {
      peer.handle(channel, async (params) => {
        // Deny-by-default: a command the host registered on this bus is still
        // refused unless it is on the remote allow-list (the mobile trust
        // surface). This is the gate that stops a paired phone — or anyone on
        // the LAN with the bearer token — from reaching a host-mutating command
        // the desktop happened to wire onto the same bus as the chat commands.
        if (this.allowedCommands && !this.allowedCommands.has(channel)) {
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
      this.attachedTransports.delete(transport);
    });
  }

  broadcast<K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]): void {
    for (const peer of this.peers) {
      if (peer.isClosed) continue;
      try {
        // One un-serializable payload (BigInt/circular) or one bad peer must not
        // abort the fan-out to the rest — `notify` → `JSON.stringify` can throw,
        // and the throw would otherwise propagate back into the event emitter and
        // skip every peer ordered after the first failure.
        peer.notify(channel, payload);
      } catch (err) {
        console.warn('[moxxy] ws bridge: dropping broadcast to a peer', err);
      }
    }
  }

  /**
   * Deterministically tear down every attached peer (e.g. when the host stops
   * the bridge), instead of relying purely on each transport's close event.
   * Idempotent; safe to call from a host's shutdown path.
   */
  closeAll(): void {
    for (const peer of [...this.peers]) {
      try {
        peer.close();
      } catch {
        // best-effort: a transport already torn down must not block the rest
      }
    }
    this.peers.clear();
    this.attachedTransports.clear();
  }
}

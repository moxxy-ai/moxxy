/**
 * CollaborationHub — wires a {@link CollaborationState} to a unix socket so
 * separate peer processes can drive it over JSON-RPC, and exposes an
 * in-process surface (`subscribe`, `post`) for the coordinator that hosts it.
 *
 * Identity & trust: a connection is anonymous until it calls `collab.register`
 * with its agentId; thereafter the hub derives `from`/`self` from the
 * connection, so a peer cannot post or act as another agent. Peer-read RPCs
 * are delegated to an injected {@link PeerReader} (the coordinator, which has
 * filesystem access to every worktree).
 */

import { JsonRpcPeer, RpcError, createUnixSocketServer, type Transport } from '@moxxy/runner';
import type { CollabControl, CollabEvent, CollabMessage, MessageTarget, RosterEntry } from './hub-types.js';
import { CollaborationState } from './state.js';
import {
  CollabHubMethod,
  CollabHubNotification,
  COLLAB_HUB_PROTOCOL_VERSION,
  type BoardAddParams,
  type BoardClaimParams,
  type BoardReleaseParams,
  type BoardUpdateParams,
  type ContractAckParams,
  type ContractProposeParams,
  type ContractPublishParams,
  type ContractUpdateParams,
  type MarkDoneParams,
  type PeerDiffParams,
  type PeerFilesParams,
  type PeerReadParams,
  type PostMessageParams,
  type ReadInboxParams,
  type RegisterParams,
  type StatusSetParams,
} from './hub-protocol.js';

/** Serves peer-read requests by reading another agent's worktree. */
export interface PeerReader {
  files(agentId: string): Promise<ReadonlyArray<{ path: string; status: string }>>;
  read(agentId: string, path: string): Promise<string>;
  diff(agentId: string): Promise<string>;
}

interface HubLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface CollaborationHub {
  readonly socketPath: string;
  readonly state: CollaborationState;
  /** In-process subscription for the coordinator (relays events to the user log). */
  subscribe(fn: (event: CollabEvent) => void): () => void;
  /** Post a message as the coordinator/human (not over a peer connection). */
  post(from: string, to: MessageTarget, body: string, subject?: string): CollabMessage;
  /** Human step-in: pause/resume the team and/or push a steering directive. */
  setControl(patch: { paused?: boolean; directive?: string }): CollabControl;
  close(): Promise<void>;
}

export interface CreateHubOptions {
  readonly socketPath: string;
  readonly task: string;
  readonly roster: ReadonlyArray<RosterEntry>;
  readonly peerReader?: PeerReader;
  readonly logger?: HubLogger;
}

function reqString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new RpcError(`collab: "${field}" must be a non-empty string`);
  return v;
}

function optStringArray(v: unknown): ReadonlyArray<string> {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new RpcError('collab: expected string[]');
  return v as string[];
}

export async function createCollaborationHub(opts: CreateHubOptions): Promise<CollaborationHub> {
  const subscribers = new Set<(event: CollabEvent) => void>();
  const connections = new Set<JsonRpcPeer>();

  const state = new CollaborationState({
    task: opts.task,
    roster: opts.roster,
    emit: (event) => {
      for (const peer of connections) peer.notify(CollabHubNotification.Event, event);
      for (const fn of subscribers) {
        try {
          fn(event);
        } catch {
          // a throwing subscriber must not break the bus
        }
      }
    },
  });

  const peerReader = opts.peerReader;
  const requirePeerReader = (): PeerReader => {
    if (!peerReader) throw new RpcError('collab: peer-read is not available in this collaboration');
    return peerReader;
  };

  const onConnection = (transport: Transport): void => {
    const peer = new JsonRpcPeer(transport);
    connections.add(peer);
    let agentId: string | null = null;

    const me = (): string => {
      if (!agentId) throw new RpcError('collab: not registered (call collab.register first)');
      return agentId;
    };

    peer.handle(CollabHubMethod.Register, (params) => {
      const p = (params ?? {}) as Partial<RegisterParams>;
      agentId = reqString(p.agentId, 'agentId');
      return {
        ok: true as const,
        protocolVersion: COLLAB_HUB_PROTOCOL_VERSION,
        roster: state.register(agentId, {
          ...(p.runnerSocket ? { runnerSocket: p.runnerSocket } : {}),
          ...(typeof p.pid === 'number' ? { pid: p.pid } : {}),
        }),
      };
    });

    peer.handle(CollabHubMethod.PostMessage, (params) => {
      const p = (params ?? {}) as Partial<PostMessageParams>;
      const msg = state.post(me(), reqString(p.to, 'to'), reqString(p.body, 'body'), p.subject);
      return { id: msg.id };
    });

    peer.handle(CollabHubMethod.ReadInbox, (params) => {
      const p = (params ?? {}) as ReadInboxParams;
      return { messages: state.inbox(me(), p.sinceTs) };
    });

    peer.handle(CollabHubMethod.Roster, () => state.rosterView(me()));

    peer.handle(CollabHubMethod.StatusSet, (params) => {
      const p = (params ?? {}) as Partial<StatusSetParams>;
      state.setStatus(me(), reqString(p.status, 'status') as never, p.detail);
      return { ok: true };
    });

    peer.handle(CollabHubMethod.MarkDone, (params) => {
      const p = (params ?? {}) as Partial<MarkDoneParams>;
      state.markDone(me(), reqString(p.summary, 'summary'), p.artifacts);
      return { ok: true };
    });

    peer.handle(CollabHubMethod.BoardRead, () => ({ items: state.boardItems() }));

    peer.handle(CollabHubMethod.BoardAdd, (params) => {
      const p = (params ?? {}) as Partial<BoardAddParams>;
      return state.boardAdd(me(), reqString(p.title, 'title'), p.detail, optStringArray(p.paths));
    });

    peer.handle(CollabHubMethod.BoardUpdate, (params) => {
      const p = (params ?? {}) as Partial<BoardUpdateParams>;
      const item = state.boardUpdate(me(), reqString(p.id, 'id'), p.status, p.detail);
      return { ok: item !== null, item };
    });

    peer.handle(CollabHubMethod.BoardClaim, (params) => {
      const p = (params ?? {}) as Partial<BoardClaimParams>;
      return state.boardClaim(me(), optStringArray(p.paths), p.id);
    });

    peer.handle(CollabHubMethod.BoardRelease, (params) => {
      const p = (params ?? {}) as Partial<BoardReleaseParams>;
      state.boardRelease(me(), { ...(p.id ? { id: p.id } : {}), ...(p.paths ? { paths: optStringArray(p.paths) } : {}) });
      return { ok: true };
    });

    peer.handle(CollabHubMethod.ContractList, () => ({ contracts: state.contractList() }));

    peer.handle(CollabHubMethod.ContractPublish, (params) => {
      const p = (params ?? {}) as Partial<ContractPublishParams>;
      return state.contractPublish(me(), {
        title: reqString(p.title, 'title'),
        spec: reqString(p.spec, 'spec'),
        ...(p.owner ? { owner: p.owner } : {}),
        ...(p.consumers ? { consumers: optStringArray(p.consumers) } : {}),
        ...(p.artifactPath ? { artifactPath: p.artifactPath } : {}),
      });
    });

    peer.handle(CollabHubMethod.ContractPropose, (params) => {
      const p = (params ?? {}) as Partial<ContractProposeParams>;
      const entry = state.contractProposeChange(me(), reqString(p.id, 'id'), reqString(p.newSpec, 'newSpec'), reqString(p.reason, 'reason'));
      return { ok: entry !== null };
    });

    peer.handle(CollabHubMethod.ContractAck, (params) => {
      const p = (params ?? {}) as Partial<ContractAckParams>;
      const res = state.contractAckChange(me(), reqString(p.id, 'id'));
      return { ok: res !== null, agreed: res?.agreed ?? false };
    });

    peer.handle(CollabHubMethod.ContractUpdate, (params) => {
      const p = (params ?? {}) as Partial<ContractUpdateParams>;
      const entry = state.contractUpdate(me(), reqString(p.id, 'id'), reqString(p.spec, 'spec'));
      return { ok: entry !== null };
    });

    peer.handle(CollabHubMethod.PeerFiles, async (params) => {
      const p = (params ?? {}) as Partial<PeerFilesParams>;
      return { files: await requirePeerReader().files(reqString(p.agentId, 'agentId')) };
    });

    peer.handle(CollabHubMethod.PeerRead, async (params) => {
      const p = (params ?? {}) as Partial<PeerReadParams>;
      return { content: await requirePeerReader().read(reqString(p.agentId, 'agentId'), reqString(p.path, 'path')) };
    });

    peer.handle(CollabHubMethod.PeerDiff, async (params) => {
      const p = (params ?? {}) as Partial<PeerDiffParams>;
      return { diff: await requirePeerReader().diff(reqString(p.agentId, 'agentId')) };
    });

    peer.onClose(() => {
      connections.delete(peer);
      // A registered agent whose link dropped before finishing crashed.
      if (agentId) {
        const agent = state.rosterView().agents.find((a) => a.id === agentId);
        if (agent && agent.status !== 'done' && agent.status !== 'killed') {
          state.setStatus(agentId, 'crashed');
        }
      }
    });
  };

  const server = await createUnixSocketServer(opts.socketPath, opts.logger);
  server.onConnection(onConnection);

  return {
    socketPath: opts.socketPath,
    state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    post(from, to, body, subject) {
      return state.post(from, to, body, subject);
    },
    setControl(patch) {
      // A directive also lands in every inbox so peers (who check inbox each
      // cycle) act on it even between roster reads.
      if (patch.directive) state.post('human', 'all', patch.directive, 'directive');
      return state.setControl(patch);
    },
    async close() {
      for (const peer of connections) peer.close();
      connections.clear();
      subscribers.clear();
      await server.close();
    },
  };
}

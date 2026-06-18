/**
 * CollabHubClient — the peer-side connection to the collaboration hub. One per
 * peer process (see `process-client.ts`); the collab_* tools call through it.
 * Thin typed wrappers over the hub JSON-RPC methods plus a `collab.event`
 * subscription so a peer can react to others' work live.
 */

import { JsonRpcPeer, connectUnixSocket } from '@moxxy/runner';
import type {
  BoardItem,
  CollabEvent,
  CollabMessage,
  ContractEntry,
  RosterView,
} from './hub-types.js';
import {
  CollabHubMethod,
  CollabHubNotification,
  COLLAB_HUB_PROTOCOL_VERSION,
  type BoardClaimResult,
  type RegisterResult,
} from './hub-protocol.js';

export class CollabHubClient {
  private readonly eventHandlers = new Set<(event: CollabEvent) => void>();

  private constructor(
    private readonly peer: JsonRpcPeer,
    readonly agentId: string,
  ) {
    peer.on(CollabHubNotification.Event, (params) => {
      const event = params as CollabEvent;
      for (const fn of this.eventHandlers) {
        try {
          fn(event);
        } catch {
          // ignore handler errors
        }
      }
    });
  }

  static async connect(
    socketPath: string,
    agentId: string,
    info: { runnerSocket?: string; pid?: number } = {},
  ): Promise<CollabHubClient> {
    const transport = await connectUnixSocket(socketPath);
    const peer = new JsonRpcPeer(transport);
    const client = new CollabHubClient(peer, agentId);
    await peer.request<RegisterResult>(CollabHubMethod.Register, {
      agentId,
      protocolVersion: COLLAB_HUB_PROTOCOL_VERSION,
      ...info,
    });
    return client;
  }

  onEvent(fn: (event: CollabEvent) => void): () => void {
    this.eventHandlers.add(fn);
    return () => this.eventHandlers.delete(fn);
  }

  // messaging
  post(to: string, body: string, subject?: string): Promise<{ id: string }> {
    return this.peer.request(CollabHubMethod.PostMessage, { to, body, subject });
  }
  inbox(sinceTs?: number): Promise<{ messages: ReadonlyArray<CollabMessage> }> {
    return this.peer.request(CollabHubMethod.ReadInbox, { sinceTs });
  }
  roster(): Promise<RosterView> {
    return this.peer.request(CollabHubMethod.Roster);
  }
  setStatus(status: 'working' | 'blocked' | 'connected', detail?: string): Promise<{ ok: boolean }> {
    return this.peer.request(CollabHubMethod.StatusSet, { status, detail });
  }
  done(summary: string, artifacts?: ReadonlyArray<string>): Promise<{ ok: boolean }> {
    return this.peer.request(CollabHubMethod.MarkDone, { summary, artifacts });
  }

  // board / locks
  boardRead(): Promise<{ items: ReadonlyArray<BoardItem> }> {
    return this.peer.request(CollabHubMethod.BoardRead);
  }
  boardAdd(title: string, detail?: string, paths?: ReadonlyArray<string>): Promise<BoardItem> {
    return this.peer.request(CollabHubMethod.BoardAdd, { title, detail, paths });
  }
  boardUpdate(id: string, status?: string, detail?: string): Promise<{ ok: boolean; item: BoardItem | null }> {
    return this.peer.request(CollabHubMethod.BoardUpdate, { id, status, detail });
  }
  boardClaim(paths: ReadonlyArray<string>, id?: string): Promise<BoardClaimResult> {
    return this.peer.request(CollabHubMethod.BoardClaim, { paths, id });
  }
  boardRelease(opts: { id?: string; paths?: ReadonlyArray<string> }): Promise<{ ok: boolean }> {
    return this.peer.request(CollabHubMethod.BoardRelease, opts);
  }

  // contracts
  contracts(): Promise<{ contracts: ReadonlyArray<ContractEntry> }> {
    return this.peer.request(CollabHubMethod.ContractList);
  }
  contractPublish(spec: {
    title: string;
    spec: string;
    owner?: string;
    consumers?: ReadonlyArray<string>;
    artifactPath?: string;
  }): Promise<ContractEntry> {
    return this.peer.request(CollabHubMethod.ContractPublish, spec);
  }
  contractProposeChange(id: string, newSpec: string, reason: string): Promise<{ ok: boolean }> {
    return this.peer.request(CollabHubMethod.ContractPropose, { id, newSpec, reason });
  }
  contractAckChange(id: string): Promise<{ ok: boolean; agreed: boolean }> {
    return this.peer.request(CollabHubMethod.ContractAck, { id });
  }
  contractUpdate(id: string, spec: string): Promise<{ ok: boolean }> {
    return this.peer.request(CollabHubMethod.ContractUpdate, { id, spec });
  }

  // peer-read
  peerFiles(agentId: string): Promise<{ files: ReadonlyArray<{ path: string; status: string }> }> {
    return this.peer.request(CollabHubMethod.PeerFiles, { agentId });
  }
  peerRead(agentId: string, path: string): Promise<{ content: string }> {
    return this.peer.request(CollabHubMethod.PeerRead, { agentId, path });
  }
  peerDiff(agentId: string): Promise<{ diff: string }> {
    return this.peer.request(CollabHubMethod.PeerDiff, { agentId });
  }

  close(): void {
    this.peer.close();
  }
}

/**
 * Wire contract for the collaboration hub — a small JSON-RPC-over-unix-socket
 * protocol, independent of (and versioned separately from) the runner
 * protocol. The hub is hosted in-process by the coordinator; every peer
 * process connects as a client. All methods are client→hub except the
 * `collab.event` notification (hub→client), which every connection is
 * auto-subscribed to.
 */

import type {
  BoardItem,
  BoardStatus,
  CollabMessage,
  ContractEntry,
  RosterView,
} from './hub-types.js';

export const COLLAB_HUB_PROTOCOL_VERSION = 1;

/** Request methods (client → hub). */
export const CollabHubMethod = {
  // identity + messaging
  Register: 'collab.register',
  PostMessage: 'collab.post',
  ReadInbox: 'collab.inbox',
  Roster: 'collab.roster',
  StatusSet: 'collab.status',
  MarkDone: 'collab.done',
  // task board = work ledger + exclusive file-lock table
  BoardRead: 'collab.board.read',
  BoardAdd: 'collab.board.add',
  BoardUpdate: 'collab.board.update',
  BoardClaim: 'collab.board.claim',
  BoardRelease: 'collab.board.release',
  // contract registry (the shared design surface)
  ContractList: 'collab.contract.list',
  ContractPublish: 'collab.contract.publish',
  ContractPropose: 'collab.contract.proposeChange',
  ContractAck: 'collab.contract.ackChange',
  ContractUpdate: 'collab.contract.update',
  // peer-read: see another agent's ACTUAL in-progress work
  PeerFiles: 'collab.peer.files',
  PeerRead: 'collab.peer.read',
  PeerDiff: 'collab.peer.diff',
} as const;
export type CollabHubMethod = (typeof CollabHubMethod)[keyof typeof CollabHubMethod];

/** Notification methods (hub → client, no reply). */
export const CollabHubNotification = {
  /** One collaboration change. Every connection is auto-subscribed. */
  Event: 'collab.event',
} as const;
export type CollabHubNotification = (typeof CollabHubNotification)[keyof typeof CollabHubNotification];

// ---------------------------------------------------------------------------
// Params / results
// ---------------------------------------------------------------------------

export interface RegisterParams {
  readonly agentId: string;
  readonly protocolVersion: number;
  readonly runnerSocket?: string;
  readonly pid?: number;
}
export interface RegisterResult {
  readonly ok: true;
  readonly protocolVersion: number;
  readonly roster: RosterView;
}

export interface PostMessageParams {
  readonly to: string | 'all';
  readonly body: string;
  readonly subject?: string;
}
export interface PostMessageResult {
  readonly id: string;
}

export interface ReadInboxParams {
  /** Only return messages newer than this timestamp; otherwise drains the unread cursor. */
  readonly sinceTs?: number;
}
export interface ReadInboxResult {
  readonly messages: ReadonlyArray<CollabMessage>;
}

export interface BoardAddParams {
  readonly title: string;
  readonly detail?: string;
  readonly paths?: ReadonlyArray<string>;
}
export interface BoardUpdateParams {
  readonly id: string;
  readonly status?: BoardStatus;
  readonly detail?: string;
}
export interface BoardClaimParams {
  /** Existing board item to (re)assign; omit to create a pure path lease. */
  readonly id?: string;
  readonly paths: ReadonlyArray<string>;
}
export type BoardClaimResult =
  | { readonly ok: true; readonly item: BoardItem }
  | { readonly ok: false; readonly ownedBy: string; readonly paths: ReadonlyArray<string> };
export interface BoardReleaseParams {
  readonly id?: string;
  readonly paths?: ReadonlyArray<string>;
}
export interface BoardReadResult {
  readonly items: ReadonlyArray<BoardItem>;
}

export interface ContractPublishParams {
  readonly title: string;
  readonly spec: string;
  readonly owner?: string;
  readonly consumers?: ReadonlyArray<string>;
  readonly artifactPath?: string;
}
export interface ContractProposeParams {
  readonly id: string;
  readonly newSpec: string;
  readonly reason: string;
}
export interface ContractAckParams {
  readonly id: string;
}
export interface ContractUpdateParams {
  readonly id: string;
  readonly spec: string;
}
export interface ContractListResult {
  readonly contracts: ReadonlyArray<ContractEntry>;
}

export interface StatusSetParams {
  readonly status: 'working' | 'blocked' | 'connected';
  readonly detail?: string;
}
export interface MarkDoneParams {
  readonly summary: string;
  readonly artifacts?: ReadonlyArray<string>;
}

export interface PeerFilesParams {
  readonly agentId: string;
}
export interface PeerFilesResult {
  readonly files: ReadonlyArray<{ readonly path: string; readonly status: string }>;
}
export interface PeerReadParams {
  readonly agentId: string;
  readonly path: string;
}
export interface PeerReadResult {
  readonly content: string;
}
export interface PeerDiffParams {
  readonly agentId: string;
}
export interface PeerDiffResult {
  readonly diff: string;
}

export interface OkResult {
  readonly ok: boolean;
}

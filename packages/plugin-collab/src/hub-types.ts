/**
 * Shared data model for a collaboration. These types cross the hub wire
 * (`hub-protocol.ts`), live in the in-memory {@link CollaborationState}, and
 * are projected onto the coordinator's session log as `collab_*` plugin
 * events, so they are intentionally plain, JSON-serializable shapes.
 */

/** Lifecycle status of one agent in a collaboration. */
export type AgentStatus =
  | 'pending' // in the roster, process not yet spawned/registered
  | 'connected' // registered with the hub
  | 'working' // actively running a turn
  | 'blocked' // waiting on a peer / contract decision
  | 'done' // called collab_done
  | 'crashed' // process died unexpectedly
  | 'killed'; // shut down by the coordinator

export type AgentRole = 'architect' | 'implementer';

/** What the architect proposes (and the user can edit) before launch. */
export interface RosterEntry {
  /** Stable slug — used in branch names, socket names, env vars. */
  readonly id: string;
  /** Human display name, e.g. "Backend Engineer". */
  readonly name: string;
  readonly role: AgentRole;
  /** What THIS agent should accomplish (its kickoff prompt). */
  readonly subtask: string;
  /** File/area ownership the architect assigned (advisory + pre-seeded claims). */
  readonly ownedPaths?: ReadonlyArray<string>;
  /** Optional per-agent model override (defaults to the coordinator's). */
  readonly model?: string;
}

/** A roster entry plus live runtime state, held by the hub. */
export interface RosterAgent extends RosterEntry {
  status: AgentStatus;
  /** The peer's own RunnerServer socket — lets the desktop attach for the full transcript. */
  runnerSocket?: string;
  pid?: number;
  doneSummary?: string;
}

/** A direct agentId, or `'all'` for a broadcast. */
export type MessageTarget = string | 'all';

export interface CollabMessage {
  readonly id: string;
  /** agentId | 'human' | 'coordinator'. */
  readonly from: string;
  readonly to: MessageTarget;
  readonly subject?: string;
  readonly body: string;
  readonly ts: number;
}

export type BoardStatus = 'open' | 'claimed' | 'in_progress' | 'blocked' | 'done';

export interface BoardItem {
  readonly id: string;
  title: string;
  detail?: string;
  status: BoardStatus;
  /** agentId that owns this item / its files. */
  owner?: string;
  /** Files this item exclusively leases (the cross-process lock). */
  paths?: ReadonlyArray<string>;
  readonly createdBy: string;
  updatedBy: string;
  updatedAt: number;
}

export type ContractStatus = 'published' | 'change_proposed' | 'changed';

/** One agreed interface/boundary where agents' work meets. */
export interface ContractEntry {
  readonly id: string;
  title: string;
  /** agentId responsible for the contract (usually the architect or a feature owner). */
  owner: string;
  /** agentIds that depend on this contract. */
  consumers: ReadonlyArray<string>;
  /** The agreed interface/shape — text or code. */
  spec: string;
  /** File where the concrete interface lives, if any. */
  artifactPath?: string;
  status: ContractStatus;
  version: number;
  /** An in-flight change awaiting acks from owner + consumers. */
  pendingChange?: {
    readonly newSpec: string;
    readonly reason: string;
    readonly proposedBy: string;
    readonly acks: ReadonlyArray<string>;
  };
}

/**
 * Live human-in-the-loop control. The user can pause the team or push a
 * steering directive at any time (desktop controls / `/collab_*` commands →
 * coordinator → hub). Peers read this each work cycle and honor it: a directive
 * overrides their current plan; while paused they finish their current edit and
 * idle until resumed. (Hard stop is the coordinator turn's abort.)
 */
export interface CollabControl {
  paused: boolean;
  /** The latest human directive — agents treat it as authoritative. */
  directive?: string;
  directiveTs?: number;
}

export interface RosterView {
  /** The calling agent's id (filled by the hub from the connection), or null. */
  readonly self: string | null;
  readonly task: string;
  readonly agents: ReadonlyArray<RosterAgent>;
  readonly control: CollabControl;
}

/**
 * A single change on the collaboration. Broadcast to every hub client (so
 * peers stay aware) and relayed by the coordinator onto the user's session
 * log as a `collab_*` plugin event (so the UI renders it live).
 */
export type CollabEvent =
  | { readonly kind: 'agent_status'; readonly agentId: string; readonly status: AgentStatus; readonly detail?: string }
  | { readonly kind: 'message'; readonly message: CollabMessage }
  | { readonly kind: 'board'; readonly action: 'add' | 'update' | 'claim' | 'release'; readonly item: BoardItem }
  | {
      readonly kind: 'contract';
      readonly action: 'published' | 'change_proposed' | 'changed';
      readonly contract: ContractEntry;
    }
  | {
      readonly kind: 'agent_done';
      readonly agentId: string;
      readonly summary: string;
      readonly artifacts?: ReadonlyArray<string>;
    }
  | { readonly kind: 'control'; readonly control: CollabControl };

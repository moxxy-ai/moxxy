/**
 * CollaborationState — the pure, in-memory model behind the hub: roster +
 * message bus + task board (which doubles as the exclusive file-lock table)
 * + contract registry. It has no knowledge of sockets; the hub
 * (`hub.ts`) wires it to a unix socket, and the coordinator subscribes to its
 * events in-process. Kept pure so it is exhaustively unit-testable.
 *
 * Every mutation funnels through `emit(...)`, which the owner wires to both
 * the socket fan-out (peers stay aware) and the coordinator's session log
 * (the UI renders live).
 */

import type {
  AgentRole,
  AgentStatus,
  BoardItem,
  BoardStatus,
  CollabControl,
  CollabEvent,
  CollabMessage,
  ContractEntry,
  MessageTarget,
  RosterAgent,
  RosterEntry,
  RosterView,
} from './hub-types.js';
import type { BoardClaimResult } from './hub-protocol.js';

export interface CollaborationStateOptions {
  readonly task: string;
  readonly roster: ReadonlyArray<RosterEntry>;
  /** Injected clock for deterministic tests; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Fired on every mutation. The owner fans this out + relays to the user log. */
  readonly emit?: (event: CollabEvent) => void;
}

/** Normalize a claim/file path for prefix comparison. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** True when two path claims overlap (equal, or one is a directory-prefix of the other). */
export function pathsConflict(a: string, b: string): boolean {
  const x = normPath(a);
  const y = normPath(b);
  if (x === y) return true;
  return x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

export class CollaborationState {
  readonly task: string;
  private readonly now: () => number;
  private readonly emitFn: (event: CollabEvent) => void;

  private readonly agents = new Map<string, RosterAgent>();
  private readonly agentOrder: string[] = [];

  private readonly messages: CollabMessage[] = [];
  /** Per-agent read cursor (index into `messages`) for `inbox()` draining. */
  private readonly inboxCursor = new Map<string, number>();

  private readonly board = new Map<string, BoardItem>();
  private readonly boardOrder: string[] = [];

  private readonly contracts = new Map<string, ContractEntry>();
  private readonly contractOrder: string[] = [];

  private control: CollabControl = { paused: false };

  private msgSeq = 0;
  private boardSeq = 0;
  private contractSeq = 0;

  constructor(opts: CollaborationStateOptions) {
    this.task = opts.task;
    this.now = opts.now ?? Date.now;
    this.emitFn = opts.emit ?? (() => {});
    for (const entry of opts.roster) {
      this.agents.set(entry.id, { ...entry, status: 'pending' });
      this.agentOrder.push(entry.id);
    }
  }

  // --- roster / lifecycle ---------------------------------------------------

  /** Mark an agent connected, recording its runner socket + pid. */
  register(agentId: string, info: { runnerSocket?: string; pid?: number }): RosterView {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`unknown agent "${agentId}"`);
    if (info.runnerSocket !== undefined) agent.runnerSocket = info.runnerSocket;
    if (info.pid !== undefined) agent.pid = info.pid;
    this.setStatus(agentId, 'connected');
    return this.rosterView(agentId);
  }

  /** Add an agent after construction (the architect proposes implementers once
   *  the hub is already live). No-op if the id already exists. */
  addAgent(entry: RosterEntry): void {
    if (this.agents.has(entry.id)) return;
    this.agents.set(entry.id, { ...entry, status: 'pending' });
    this.agentOrder.push(entry.id);
  }

  setStatus(agentId: string, status: AgentStatus, detail?: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.status === status) return;
    agent.status = status;
    this.emitFn({ kind: 'agent_status', agentId, status, ...(detail ? { detail } : {}) });
  }

  markDone(agentId: string, summary: string, artifacts?: ReadonlyArray<string>): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.doneSummary = summary;
    agent.status = 'done';
    this.emitFn({ kind: 'agent_status', agentId, status: 'done' });
    this.emitFn({ kind: 'agent_done', agentId, summary, ...(artifacts ? { artifacts } : {}) });
  }

  allDone(): boolean {
    const live = this.agentOrder
      .map((id) => this.agents.get(id)!)
      .filter((a) => a.status !== 'crashed' && a.status !== 'killed');
    return live.length > 0 && live.every((a) => a.status === 'done');
  }

  roleOf(agentId: string): AgentRole | undefined {
    return this.agents.get(agentId)?.role;
  }

  rosterView(self: string | null = null): RosterView {
    return {
      self,
      task: this.task,
      agents: this.agentOrder.map((id) => ({ ...this.agents.get(id)! })),
      control: { ...this.control },
    };
  }

  /** Human-in-the-loop step-in: pause/resume the team and/or push a directive. */
  setControl(patch: { paused?: boolean; directive?: string }): CollabControl {
    if (patch.paused !== undefined) this.control.paused = patch.paused;
    if (patch.directive !== undefined) {
      this.control.directive = patch.directive;
      this.control.directiveTs = this.now();
    }
    const snapshot = { ...this.control };
    this.emitFn({ kind: 'control', control: snapshot });
    return snapshot;
  }

  controlState(): CollabControl {
    return { ...this.control };
  }

  doneSummaries(): ReadonlyArray<{ agentId: string; summary: string }> {
    return this.agentOrder
      .map((id) => this.agents.get(id)!)
      .filter((a) => a.status === 'done' && a.doneSummary)
      .map((a) => ({ agentId: a.id, summary: a.doneSummary! }));
  }

  // --- messaging ------------------------------------------------------------

  post(from: string, to: MessageTarget, body: string, subject?: string): CollabMessage {
    const message: CollabMessage = {
      id: `m${++this.msgSeq}`,
      from,
      to,
      ...(subject ? { subject } : {}),
      body,
      ts: this.now(),
    };
    this.messages.push(message);
    this.emitFn({ kind: 'message', message });
    return message;
  }

  /** Messages addressed to `agentId` (or broadcast by others). With `sinceTs`,
   *  filters by time; otherwise drains the unread cursor and advances it. */
  inbox(agentId: string, sinceTs?: number): ReadonlyArray<CollabMessage> {
    const relevant = (m: CollabMessage): boolean =>
      m.from !== agentId && (m.to === 'all' || m.to === agentId);
    if (sinceTs !== undefined) {
      return this.messages.filter((m) => m.ts > sinceTs && relevant(m));
    }
    const start = this.inboxCursor.get(agentId) ?? 0;
    const out = this.messages.slice(start).filter(relevant);
    this.inboxCursor.set(agentId, this.messages.length);
    return out;
  }

  allMessages(): ReadonlyArray<CollabMessage> {
    return this.messages.slice();
  }

  // --- task board + file locks ----------------------------------------------

  boardItems(): ReadonlyArray<BoardItem> {
    return this.boardOrder.map((id) => ({ ...this.board.get(id)! }));
  }

  boardAdd(by: string, title: string, detail?: string, paths?: ReadonlyArray<string>): BoardItem {
    const item: BoardItem = {
      id: `t${++this.boardSeq}`,
      title,
      ...(detail ? { detail } : {}),
      status: 'open',
      ...(paths && paths.length > 0 ? { paths } : {}),
      createdBy: by,
      updatedBy: by,
      updatedAt: this.now(),
    };
    this.board.set(item.id, item);
    this.boardOrder.push(item.id);
    this.emitFn({ kind: 'board', action: 'add', item: { ...item } });
    return item;
  }

  boardUpdate(by: string, id: string, status?: BoardStatus, detail?: string): BoardItem | null {
    const item = this.board.get(id);
    if (!item) return null;
    if (status) item.status = status;
    if (detail !== undefined) item.detail = detail;
    item.updatedBy = by;
    item.updatedAt = this.now();
    this.emitFn({ kind: 'board', action: 'update', item: { ...item } });
    return item;
  }

  /** Find the agent that already owns a path conflicting with any of `paths`. */
  private conflictingOwner(claimant: string, paths: ReadonlyArray<string>): string | null {
    for (const id of this.boardOrder) {
      const item = this.board.get(id)!;
      if (!item.owner || item.owner === claimant || !item.paths) continue;
      if (item.status === 'done') continue; // released by completion
      for (const owned of item.paths) {
        if (paths.some((p) => pathsConflict(p, owned))) return item.owner;
      }
    }
    return null;
  }

  /** Exclusive path lease — the cross-process file lock. Rejects on overlap. */
  boardClaim(by: string, paths: ReadonlyArray<string>, id?: string): BoardClaimResult {
    const owner = this.conflictingOwner(by, paths);
    if (owner) return { ok: false, ownedBy: owner, paths };
    let item = id ? this.board.get(id) : undefined;
    if (!item) {
      item = {
        id: id ?? `t${++this.boardSeq}`,
        title: paths.join(', '),
        status: 'claimed',
        paths,
        createdBy: by,
        updatedBy: by,
        updatedAt: this.now(),
      };
      this.board.set(item.id, item);
      this.boardOrder.push(item.id);
    } else {
      item.paths = paths;
      item.status = item.status === 'open' ? 'claimed' : item.status;
    }
    item.owner = by;
    item.updatedBy = by;
    item.updatedAt = this.now();
    this.emitFn({ kind: 'board', action: 'claim', item: { ...item } });
    return { ok: true, item: { ...item } };
  }

  boardRelease(by: string, opts: { id?: string; paths?: ReadonlyArray<string> }): void {
    const targets = opts.id
      ? [this.board.get(opts.id)].filter(Boolean as unknown as (x: BoardItem | undefined) => x is BoardItem)
      : this.boardOrder
          .map((id) => this.board.get(id)!)
          .filter((it) => it.owner === by && it.paths && opts.paths?.some((p) => it.paths!.some((q) => pathsConflict(p, q))));
    for (const item of targets) {
      delete item.owner;
      item.updatedBy = by;
      item.updatedAt = this.now();
      this.emitFn({ kind: 'board', action: 'release', item: { ...item } });
    }
  }

  // --- contracts ------------------------------------------------------------

  contractList(): ReadonlyArray<ContractEntry> {
    return this.contractOrder.map((id) => ({ ...this.contracts.get(id)! }));
  }

  contractPublish(
    by: string,
    spec: { title: string; spec: string; owner?: string; consumers?: ReadonlyArray<string>; artifactPath?: string },
  ): ContractEntry {
    const entry: ContractEntry = {
      id: `c${++this.contractSeq}`,
      title: spec.title,
      owner: spec.owner ?? by,
      consumers: spec.consumers ?? [],
      spec: spec.spec,
      ...(spec.artifactPath ? { artifactPath: spec.artifactPath } : {}),
      status: 'published',
      version: 1,
    };
    this.contracts.set(entry.id, entry);
    this.contractOrder.push(entry.id);
    this.emitFn({ kind: 'contract', action: 'published', contract: { ...entry } });
    return entry;
  }

  contractProposeChange(by: string, id: string, newSpec: string, reason: string): ContractEntry | null {
    const entry = this.contracts.get(id);
    if (!entry) return null;
    entry.status = 'change_proposed';
    entry.pendingChange = { newSpec, reason, proposedBy: by, acks: [by] };
    this.emitFn({ kind: 'contract', action: 'change_proposed', contract: { ...entry } });
    return entry;
  }

  /** Record an ack from a consumer/owner. Returns whether everyone has agreed. */
  contractAckChange(by: string, id: string): { entry: ContractEntry; agreed: boolean } | null {
    const entry = this.contracts.get(id);
    if (!entry || !entry.pendingChange) return null;
    if (!entry.pendingChange.acks.includes(by)) {
      entry.pendingChange = { ...entry.pendingChange, acks: [...entry.pendingChange.acks, by] };
    }
    const required = new Set<string>([entry.owner, ...entry.consumers]);
    const agreed = [...required].every((a) => entry.pendingChange!.acks.includes(a));
    return { entry: { ...entry }, agreed };
  }

  /** Commit a contract change (architect applies the agreed/new spec). */
  contractUpdate(by: string, id: string, spec: string): ContractEntry | null {
    const entry = this.contracts.get(id);
    if (!entry) return null;
    entry.spec = spec;
    entry.status = 'changed';
    entry.version += 1;
    delete entry.pendingChange;
    entry.owner = entry.owner || by;
    this.emitFn({ kind: 'contract', action: 'changed', contract: { ...entry } });
    return entry;
  }
}

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

/** Soft cap on retained messages. A runaway broadcast loop or a very long,
 *  chatty collaboration would otherwise grow the heap unbounded; past this we
 *  evict the oldest messages that EVERY drain reader has already consumed (never
 *  dropping anything still unread), so the only loss is history no one is owed. */
const MAX_MESSAGES = 5000;

/** Hard ceiling. The soft trim only evicts fully-drained prefix, so a reader
 *  that never drains (e.g. a sinceTs-only poller, or one that disconnected)
 *  would pin history forever. Past this absolute ceiling we drop the oldest
 *  regardless to keep memory bounded — the trade-off is that a late joiner can
 *  no longer replay the very oldest history under a pathological message flood. */
const MAX_MESSAGES_HARD = MAX_MESSAGES * 4;

/** Normalize a claim/file path for prefix comparison. */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** De-duplicate a list of path claims by their normalized form, preserving order. */
function uniquePaths(paths: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = normPath(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
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
  /** Per-agent read cursor (LOGICAL index into the message stream) for `inbox()`
   *  draining. Logical index = physical index + `messagesDropped`. */
  private readonly inboxCursor = new Map<string, number>();
  /** Count of oldest messages evicted from `messages[]` to bound memory. The
   *  physical array stores only `messages[i]` for logical index `i + this`. */
  private messagesDropped = 0;
  /** Per-agent high-water mark of the `sinceTs` poll path: the latest ts already
   *  delivered to that agent plus the ids delivered AT that ts. Lets the poll
   *  path deliver same-millisecond messages that arrive after the cursor
   *  advanced (a strict `m.ts > sinceTs` permanently drops them) while never
   *  re-delivering a message already returned. */
  private readonly sinceSeen = new Map<string, { maxTs: number; idsAtMax: Set<string> }>();

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
   *  the hub is already live). No-op if the id already exists. Emits the new
   *  agent's initial status so live peers (and the UI) learn a teammate joined
   *  off the event stream instead of having to re-poll the roster. */
  addAgent(entry: RosterEntry): void {
    if (this.agents.has(entry.id)) return;
    this.agents.set(entry.id, { ...entry, status: 'pending' });
    this.agentOrder.push(entry.id);
    this.emitFn({ kind: 'agent_status', agentId: entry.id, status: 'pending' });
  }

  setStatus(agentId: string, status: AgentStatus, detail?: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.status === status) return;
    agent.status = status;
    this.emitFn({ kind: 'agent_status', agentId, status, ...(detail ? { detail } : {}) });
    // A dead/failed agent can never release its own locks, so do it for it —
    // otherwise its leases block every survivor forever (conflictingOwner only
    // frees 'done' items, not abandoned ones).
    if (status === 'crashed' || status === 'killed' || status === 'failed') this.releaseAllFor(agentId);
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
      .filter((a) => a.status !== 'crashed' && a.status !== 'killed' && a.status !== 'failed');
    return live.length > 0 && live.every((a) => a.status === 'done');
  }

  roleOf(agentId: string): AgentRole | undefined {
    return this.agents.get(agentId)?.role;
  }

  /** True when `agentId` is a known roster slot (constructed or added later). */
  knowsAgent(agentId: string): boolean {
    return this.agents.has(agentId);
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
    this.trimMessages();
    this.emitFn({ kind: 'message', message });
    return message;
  }

  /** Evict the oldest messages once `messages[]` exceeds the soft cap, but only
   *  those already drained by EVERY agent's `inbox()` cursor — so a slow reader
   *  never silently loses an unread message. `messagesDropped` keeps the logical
   *  cursor arithmetic correct. (sinceTs pollers re-scan by ts and only ever ask
   *  for recent history, so dropping fully-drained prefix is safe for them too.) */
  private trimMessages(): void {
    if (this.messages.length <= MAX_MESSAGES) return;
    // Lowest logical index any agent still needs. An agent that has never drained
    // pins index 0, so we only ever trim a prefix everyone has consumed.
    let minCursor = this.messagesDropped + this.messages.length;
    for (const id of this.agentOrder) {
      minCursor = Math.min(minCursor, this.inboxCursor.get(id) ?? 0);
    }
    let dropCount = minCursor - this.messagesDropped;
    // Backstop: if no safe prefix is drainable but we're past the hard ceiling,
    // drop oldest anyway so memory stays bounded under a pathological flood.
    if (dropCount <= 0) {
      if (this.messages.length <= MAX_MESSAGES_HARD) return;
      dropCount = this.messages.length - MAX_MESSAGES;
    }
    this.messages.splice(0, dropCount);
    this.messagesDropped += dropCount;
  }

  /** Messages addressed to `agentId` (or broadcast by others). With `sinceTs`,
   *  filters by time; otherwise drains the unread cursor and advances it. */
  inbox(agentId: string, sinceTs?: number): ReadonlyArray<CollabMessage> {
    const relevant = (m: CollabMessage): boolean =>
      m.from !== agentId && (m.to === 'all' || m.to === agentId);
    if (sinceTs !== undefined) {
      // `ts` has only millisecond granularity, so a peer routinely posts several
      // messages in the same ms. A strict `m.ts > sinceTs` permanently drops a
      // message that lands at the boundary ms AFTER the caller advanced its
      // cursor to it. Per agent we remember what was actually delivered at the
      // newest ts; a same-ms straggler (id not yet delivered at that ts) is
      // returned exactly once, while messages at a ts never polled here stay
      // strictly-greater (so the caller's `sinceTs` floor is honored).
      const seen = this.sinceSeen.get(agentId);
      const deliver = (m: CollabMessage): boolean => {
        if (!relevant(m)) return false;
        if (m.ts > sinceTs) return true;
        // ts === sinceTs is only a straggler if we previously polled at this ts
        // for this agent and haven't delivered this id yet.
        return seen !== undefined && m.ts === seen.maxTs && !seen.idsAtMax.has(m.id);
      };
      const out = this.messages.filter(deliver);
      for (const m of out) {
        const cur = this.sinceSeen.get(agentId);
        if (!cur || m.ts > cur.maxTs) {
          this.sinceSeen.set(agentId, { maxTs: m.ts, idsAtMax: new Set([m.id]) });
        } else if (m.ts === cur.maxTs) {
          cur.idsAtMax.add(m.id);
        }
      }
      return out;
    }
    const start = this.inboxCursor.get(agentId) ?? 0;
    const physStart = Math.max(0, start - this.messagesDropped);
    const out = this.messages.slice(physStart).filter(relevant);
    this.inboxCursor.set(agentId, this.messagesDropped + this.messages.length);
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
    // De-dup once up front so the create path matches the re-claim (merge) path
    // and a peer can't smuggle the same path in twice (e.g. ['a','a','./a']).
    const wanted = uniquePaths(paths);
    const owner = this.conflictingOwner(by, wanted);
    if (owner) return { ok: false, ownedBy: owner, paths };
    // A caller-supplied id only ever ATTACHES the claim to an EXISTING item. We
    // never mint a NEW item under a caller id: caller ids share no namespace with
    // the `t<n>` auto-counter, so a peer can't pre-create `t5` and have a later
    // auto-claim clobber it (and overwrite/steal its lock with no release event).
    const item = id ? this.board.get(id) : undefined;
    // A NEW claim with no usable paths is a meaningless, pathless lock — a junk
    // board item that locks nothing. The tool schema enforces min(1), but the hub
    // is the trust boundary, so a malformed RPC must be rejected here, not minted.
    // (A re-claim of an EXISTING item with empty paths stays a harmless status
    // touch below, so this only rejects the nonsensical create.)
    if (!item && wanted.length === 0) {
      return { ok: false, ownedBy: by, paths };
    }
    // (Re)assigning an existing item must not hijack one another agent already
    // owns: an item's current owner still holds whatever paths it leased even if
    // those paths don't overlap the freshly requested ones (which is why
    // conflictingOwner can pass). Reject so a peer can't steal ownership by id.
    if (item && item.owner && item.owner !== by) {
      return { ok: false, ownedBy: item.owner, paths };
    }
    if (!item) {
      const created: BoardItem = {
        id: `t${++this.boardSeq}`,
        title: wanted.join(', '),
        status: 'claimed',
        paths: wanted,
        owner: by,
        createdBy: by,
        updatedBy: by,
        updatedAt: this.now(),
      };
      this.board.set(created.id, created);
      this.boardOrder.push(created.id);
      this.emitFn({ kind: 'board', action: 'claim', item: { ...created } });
      return { ok: true, item: { ...created } };
    }
    // Re-claiming an existing item MERGES paths (union) rather than replacing
    // them: a narrowing replace would silently drop the lock on the omitted
    // paths (no release event, no conflictingOwner protection) while the owner
    // may still be editing them — corrupting the file-lock invariant.
    item.paths = uniquePaths([...(item.paths ?? []), ...wanted]);
    item.status = item.status === 'open' ? 'claimed' : item.status;
    item.owner = by;
    item.updatedBy = by;
    item.updatedAt = this.now();
    this.emitFn({ kind: 'board', action: 'claim', item: { ...item } });
    return { ok: true, item: { ...item } };
  }

  boardRelease(by: string, opts: { id?: string; paths?: ReadonlyArray<string> }): void {
    // Only the owner may release a lock — both the id path and the paths path.
    // Releasing by id used to skip this check, letting any peer drop another
    // agent's exclusive lease (the publicly-readable board ids are guessable),
    // which silently defeated the cross-process file lock.
    const targets = opts.id
      ? [this.board.get(opts.id)].filter(
          (it): it is BoardItem => it !== undefined && it.owner === by,
        )
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

  /** Drop every exclusive lease an agent holds (e.g. when it crashed/was
   *  killed), emitting a release event per item so peers + the UI stay in sync.
   *  Without this a dead owner would hold its file locks forever, deadlocking
   *  any survivor that needs those paths. */
  private releaseAllFor(agentId: string): void {
    for (const id of this.boardOrder) {
      const item = this.board.get(id)!;
      if (item.owner !== agentId) continue;
      delete item.owner;
      item.updatedBy = agentId;
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

  /**
   * Commit a contract change (the architect/owner applies the agreed spec).
   *
   * Authority + agreement are enforced so a single consumer can't silently
   * rewrite the agreed boundary everyone else is building against (the
   * propose→ack→commit protocol was previously advisory only):
   *  - `by` must be the contract owner or carry the `architect` role; and
   *  - any in-flight `pendingChange` must already be fully agreed (every
   *    required owner+consumer ack present) before it can land.
   * Returns null on not-found OR a rejected commit (the caller surfaces ok:false).
   */
  contractUpdate(by: string, id: string, spec: string): ContractEntry | null {
    const entry = this.contracts.get(id);
    if (!entry) return null;
    const authorized = by === entry.owner || this.roleOf(by) === 'architect';
    if (!authorized) return null;
    if (entry.pendingChange) {
      const required = new Set<string>([entry.owner, ...entry.consumers]);
      const agreed = [...required].every((a) => entry.pendingChange!.acks.includes(a));
      if (!agreed) return null;
    }
    entry.spec = spec;
    entry.status = 'changed';
    entry.version += 1;
    delete entry.pendingChange;
    entry.owner = entry.owner || by;
    this.emitFn({ kind: 'contract', action: 'changed', contract: { ...entry } });
    return entry;
  }
}

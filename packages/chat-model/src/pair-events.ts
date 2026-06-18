import type { MoxxyEvent, PluginEvent, ToolCompactPresentation } from '@moxxy/sdk';
import { isFileDiffDisplay } from '@moxxy/sdk/tool-display';
import type {
  Block,
  CollabAgentView,
  CollaborationBlock,
  LiveToolBlockData,
  LiveToolCall,
  SkillScopeBlock,
  SubagentBlock,
  SubagentGroupBlock,
  ToolCallBlockData,
} from './types.js';
import { oneLine } from './format.js';

const SUBAGENT_PLUGIN_ID = '@moxxy/subagents';
const COLLAB_PLUGIN_ID = '@moxxy/mode-collaborative';

/**
 * Tools whose results carry a `file-diff` display. They render as their own
 * standalone block (with an inline diff preview) rather than folding into a
 * compact "Writing 1 file…" live aggregate — so the user sees what changed
 * without expanding. Diff *rendering* is shape-driven (`isFileDiffResult`),
 * so a plugin tool emitting the same payload still renders richly; this set
 * only governs the request-time aggregation decision (no outcome yet then).
 */
export const FILE_DIFF_TOOL_NAMES: ReadonlySet<string> = new Set(['Write', 'Edit']);

/** Does this settled outcome carry a renderable file diff? */
export function isFileDiffResult(
  outcome: ToolCallBlockData['outcome'],
): outcome is import('@moxxy/sdk').ToolResultEvent {
  return (
    outcome !== null &&
    outcome.type === 'tool_result' &&
    outcome.ok &&
    isFileDiffDisplay((outcome.output as { display?: unknown } | undefined)?.display)
  );
}

/**
 * Fold a subagent `plugin_event` into the `subagents` map / `root` array.
 * Subagent events render as one-line scope blocks so a fleet of children
 * doesn't drown the main chat. Subagents always live at the top level — a
 * spawned agent is a first-class actor, not a child of whatever skill
 * spawned it — so this only ever pushes to `root` (never the open scope).
 */
function handleSubagentEvent(
  e: PluginEvent,
  subagents: Map<string, SubagentBlock>,
  root: Block[],
  groupRef: { current: SubagentGroupBlock | null },
): void {
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const childSessionId = String(payload.childSessionId ?? '');
  if (!childSessionId) return;
  if (e.subtype === 'subagent_started') {
    const agentType = String(payload.agentType ?? 'default');
    const block: SubagentBlock = {
      kind: 'subagent',
      id: e.id,
      childSessionId,
      label: String(payload.label ?? 'agent'),
      agentType,
      startedAtMs: new Date(e.ts).getTime(),
      completedAtMs: null,
      toolCallCount: 0,
      tokensUsed: null,
      toolCalls: [],
      stopReason: null,
      finalPreview: null,
      error: null,
    };
    subagents.set(childSessionId, block);
    // Fold consecutive sibling agents (a dispatch_agent fan-out) into one
    // group. The run is broken by any non-subagent block (see pushBlock /
    // boundary resets), so a fresh `subagent_started` after that opens a new
    // group. A lone agent renders as a group of one.
    if (groupRef.current) {
      groupRef.current.agents.push(block);
      if (groupRef.current.agentType !== agentType) groupRef.current.agentType = 'mixed';
    } else {
      const group: SubagentGroupBlock = {
        kind: 'subagent-group',
        id: `subagentgroup:${e.id}`,
        agentType,
        agents: [block],
      };
      groupRef.current = group;
      root.push(group);
    }
    return;
  }
  const block = subagents.get(childSessionId);
  if (!block) return;
  if (e.subtype === 'subagent_tool_call') {
    block.toolCallCount += 1;
    block.toolCalls.push({ name: String(payload.name ?? 'tool'), input: payload.input });
    return;
  }
  if (e.subtype === 'subagent_completed') {
    block.completedAtMs = new Date(e.ts).getTime();
    block.stopReason = String(payload.stopReason ?? '');
    // `null` until a total arrives (the type is number | null): a missing
    // total must stay null so the renderer omits the token segment entirely
    // rather than showing a misleading "0".
    block.tokensUsed = typeof payload.tokensUsed === 'number' ? payload.tokensUsed : null;
    const text = typeof payload.text === 'string' ? payload.text : '';
    if (text) block.finalPreview = oneLine(text);
    if (typeof payload.error === 'string') block.error = payload.error;
    return;
  }
  if (e.subtype === 'subagent_error' || e.subtype === 'subagent_abort') {
    block.completedAtMs = new Date(e.ts).getTime();
    const reason =
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.reason === 'string' && payload.reason) ||
      'aborted';
    block.error = reason;
    return;
  }
  // chunk / tool_result / nested-grand-child: ignore at top level;
  // the /agents modal exposes the raw stream when needed.
}

function collabUpsertAgent(
  block: CollaborationBlock,
  id: string,
  patch: Partial<CollabAgentView>,
): void {
  let a = block.agents.find((x) => x.id === id);
  if (!a) {
    a = { id, name: id, role: 'implementer', status: 'pending', subtask: null, summary: null };
    block.agents.push(a);
  }
  Object.assign(a, patch);
}

function newCollabBlock(id: string, atMs: number, task = ''): CollaborationBlock {
  return {
    kind: 'collab',
    id,
    task,
    parallel: false,
    fallbackReason: null,
    startedAtMs: atMs,
    completedAtMs: null,
    agents: [],
    messages: [],
    tasks: [],
    contracts: [],
    conflicts: [],
    control: null,
    summary: null,
    doneCount: null,
    totalCount: null,
  };
}

/**
 * Fold a `collab_*` plugin_event (from the collaborative coordinator) into the
 * open {@link CollaborationBlock}. One block per run (opened on collab_started);
 * subsequent events mutate it in place — roster, agent statuses, the message
 * bus, the task board, contracts, human control, and the outcome.
 */
function handleCollabEvent(
  e: PluginEvent,
  ref: { current: CollaborationBlock | null },
  root: Block[],
): void {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const atMs = new Date(e.ts).getTime();
  if (e.subtype === 'collab_started') {
    const block = newCollabBlock(e.id, atMs, String(p.task ?? ''));
    block.parallel = Boolean(p.parallel);
    ref.current = block;
    root.push(block);
    return;
  }
  // Only collab_started opens a run. Stray events with no open block — e.g. a
  // `collab_blocked` from a refused start (its assistant_message carries the
  // reason) — never create an empty block.
  const block = ref.current;
  if (!block) return;
  switch (e.subtype) {
    case 'collab_fallback_sequential':
      block.fallbackReason = String(p.reason ?? '');
      break;
    case 'collab_roster_proposed':
    case 'collab_roster_confirmed': {
      const roster = Array.isArray(p.roster) ? (p.roster as Array<Record<string, unknown>>) : [];
      for (const r of roster) {
        if (typeof r.id === 'string') {
          collabUpsertAgent(block, r.id, {
            name: String(r.name ?? r.id),
            role: String(r.role ?? 'implementer'),
            subtask: typeof r.subtask === 'string' ? r.subtask : null,
          });
        }
      }
      break;
    }
    case 'collab_agent_spawned':
      if (typeof p.id === 'string') {
        collabUpsertAgent(block, p.id, { role: String(p.role ?? 'implementer'), status: 'working' });
      }
      break;
    case 'collab_agent_status':
      if (typeof p.agentId === 'string') {
        collabUpsertAgent(block, p.agentId, { status: String(p.status ?? 'working') });
      }
      break;
    case 'collab_agent_done':
      if (typeof p.agentId === 'string') {
        collabUpsertAgent(block, p.agentId, {
          status: 'done',
          summary: typeof p.summary === 'string' ? p.summary : null,
        });
      }
      break;
    case 'collab_message': {
      const m = (p.message ?? {}) as Record<string, unknown>;
      if (typeof m.id === 'string') {
        block.messages.push({
          id: m.id,
          from: String(m.from ?? '?'),
          to: String(m.to ?? 'all'),
          ...(typeof m.subject === 'string' ? { subject: m.subject } : {}),
          body: String(m.body ?? ''),
          atMs: typeof m.ts === 'number' ? m.ts : atMs,
        });
      }
      break;
    }
    case 'collab_board_update': {
      const item = (p.item ?? {}) as Record<string, unknown>;
      if (typeof item.id === 'string') {
        const existing = block.tasks.find((x) => x.id === item.id);
        const owner = typeof item.owner === 'string' ? item.owner : null;
        if (!existing) {
          block.tasks.push({
            id: item.id,
            title: String(item.title ?? ''),
            status: String(item.status ?? 'open'),
            owner,
          });
        } else {
          existing.title = String(item.title ?? existing.title);
          existing.status = String(item.status ?? existing.status);
          existing.owner = owner ?? existing.owner;
        }
      }
      break;
    }
    case 'collab_contract_published':
    case 'collab_contract_change_proposed':
    case 'collab_contract_changed': {
      const c = (p.contract ?? {}) as Record<string, unknown>;
      if (typeof c.id === 'string') {
        const existing = block.contracts.find((x) => x.id === c.id);
        if (!existing) {
          block.contracts.push({
            id: c.id,
            title: String(c.title ?? ''),
            owner: String(c.owner ?? ''),
            status: String(c.status ?? 'published'),
            version: typeof c.version === 'number' ? c.version : 1,
          });
        } else {
          existing.title = String(c.title ?? existing.title);
          existing.owner = String(c.owner ?? existing.owner);
          existing.status = String(c.status ?? existing.status);
          existing.version = typeof c.version === 'number' ? c.version : existing.version;
        }
      }
      break;
    }
    case 'collab_control': {
      const ctrl = (p.control ?? {}) as Record<string, unknown>;
      block.control = {
        paused: Boolean(ctrl.paused),
        ...(typeof ctrl.directive === 'string' ? { directive: ctrl.directive } : {}),
      };
      break;
    }
    case 'collab_conflict':
      block.conflicts.push({
        agentId: typeof p.agentId === 'string' ? p.agentId : '?',
        files: Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === 'string') : [],
      });
      break;
    case 'collab_completed':
      block.completedAtMs = atMs;
      block.doneCount = Array.isArray(p.done) ? p.done.length : typeof p.done === 'number' ? p.done : null;
      block.totalCount = typeof p.total === 'number' ? p.total : null;
      break;
    default:
      // collab_merge and any future subtypes: no folded view needed
      break;
  }
}

/**
 * Map of tool name → compact presentation metadata. Tool registries
 * declare this at definePlugin time; the channel hands a snapshot to
 * `pairToolEvents` so the aggregator knows which tool_call_requested
 * events should fold into a live block instead of rendering individually.
 */
export type CompactToolMap = ReadonlyMap<string, ToolCompactPresentation>;

const EMPTY_COMPACT_MAP: CompactToolMap = new Map();

interface CallTarget {
  /** Mutable outcome slot — points at either a verbose ToolCallBlockData
   *  or a LiveToolCall inside a live-tools block. JS by-reference lets
   *  one map serve both. */
  outcome: ToolCallBlockData['outcome'];
}

/**
 * The full loop-carried state of {@link pairToolEvents}, lifted into a
 * struct so the per-event body ({@link stepFold}) can be applied either in
 * a batch ({@link pairToolEvents}) or one event at a time
 * ({@link IncrementalFold}).
 *
 * Both paths run the SAME {@link stepFold} over the SAME events in the SAME
 * order, so they produce byte-identical block trees — the incremental path
 * is just the batch path with its loop unrolled across calls. `root` is the
 * folded tree (mutated in place as outcomes/scopes settle); the rest is the
 * carry the algorithm threads from one event to the next.
 */
export interface FoldState {
  readonly root: Block[];
  readonly compactByName: CompactToolMap;
  // Reverse lookup: callId → the outcome-holder for that call (either a
  // ToolCallBlockData or a LiveToolCall — both have a mutable `outcome`
  // field). One map handles both kinds via structural typing.
  readonly callTargets: Map<string, CallTarget>;
  readonly suppressedCallIds: Set<string>;
  pendingLoadSkillCallId: string | null;
  openScope: SkillScopeBlock | null;
  // When an assistant_message lands mid-skill we close the current
  // scope so the message renders below the tools that preceded it
  // (preserving chronological order). If more skill tool calls come
  // afterwards, we open a continuation scope tagged with the same
  // skillEvent so the grouping carries through both visually and via
  // `countToolCalls`. Cleared at turn boundaries and on a new
  // skill_invoked.
  continuationSkillEvent: import('@moxxy/sdk').SkillInvokedEvent | null;
  // Open live-tools aggregate, if any. Lives at the current push level
  // (root or openScope.children); subsequent compact tool calls append
  // into it until something non-compact closes it.
  openLive: LiveToolBlockData | null;
  readonly subagents: Map<string, SubagentBlock>;
  // Open subagent group, if any. Consecutive `subagent_started` events accrete
  // into it; any non-subagent block (or a turn/scope boundary) closes the run.
  readonly subagentGroup: { current: SubagentGroupBlock | null };
  // Open collaborative-run block, if any. Opened on collab_started; collab_*
  // events mutate it in place; reset at the turn boundary.
  readonly collab: { current: CollaborationBlock | null };
}

/** A fresh, empty fold state for the given compact-tool map. */
export function createFoldState(compactByName: CompactToolMap = EMPTY_COMPACT_MAP): FoldState {
  return {
    root: [],
    compactByName,
    callTargets: new Map<string, CallTarget>(),
    suppressedCallIds: new Set<string>(),
    pendingLoadSkillCallId: null,
    openScope: null,
    continuationSkillEvent: null,
    openLive: null,
    subagents: new Map<string, SubagentBlock>(),
    subagentGroup: { current: null },
    collab: { current: null },
  };
}

/**
 * Apply ONE event to a {@link FoldState}, mutating `root` and the carry in
 * place. This is the exact body of the old `pairToolEvents` loop, extracted
 * verbatim so the batch and incremental folds share one code path (and thus
 * stay byte-identical). `continue` became `return`.
 */
export function stepFold(s: FoldState, e: MoxxyEvent): void {
  const pushBlock = (block: Block): void => {
    // Any non-subagent block breaks a run of sibling subagents.
    s.subagentGroup.current = null;
    if (s.openScope) {
      s.openScope.children.push(block);
    } else {
      s.root.push(block);
    }
  };

  const closeOpenLive = (): void => {
    if (s.openLive) {
      s.openLive.closed = true;
      s.openLive = null;
    }
  };

  const closeOpenScope = (): void => {
    closeOpenLive();
    if (s.openScope) {
      s.openScope.closed = true;
      s.openScope = null;
    }
  };

  // When a load_skill call has been pushed but the corresponding
  // skill_invoked hasn't arrived yet, we need to find and remove it
  // from wherever it landed (root or the previous scope's children).
  const removeBlockByCallId = (callId: string): void => {
    const removeFrom = (list: Block[]): boolean => {
      const idx = list.findIndex((b) => b.kind === 'tool-call' && b.request.callId === callId);
      if (idx >= 0) {
        list.splice(idx, 1);
        return true;
      }
      return false;
    };
    if (s.openScope && removeFrom(s.openScope.children)) return;
    removeFrom(s.root);
  };

  // UI safety net: when a new user_prompt arrives, any tool-call block
  // still showing `outcome: null` is an orphan — its result event never
  // landed. Mark it as a synthetic error so the dot stops pulsing forever
  // and the user can see *something* went wrong. The upstream modes should
  // synthesize tool_result events for these cases (and now do), but this
  // guard means a future regression can't leave a permanent stuck dot.
  const markOrphansAtTurnBoundary = (): void => {
    for (const target of s.callTargets.values()) {
      if (target.outcome === null) {
        target.outcome = {
          type: 'denied',
          reason: 'no result recorded before next turn — likely interrupted or lost',
        };
      }
    }
    s.callTargets.clear();
  };

  if (e.type === 'user_prompt') {
    closeOpenScope();
    markOrphansAtTurnBoundary();
    s.pendingLoadSkillCallId = null;
    s.continuationSkillEvent = null;
    // Suppression is a within-turn concern (a load_skill call folded into a
    // skill scope). Clearing it at the turn boundary stops a later turn that
    // happens to reuse a callId from having its tool_result silently dropped.
    s.suppressedCallIds.clear();
    s.subagentGroup.current = null;
    s.collab.current = null;
    s.root.push({ kind: 'event', id: e.id, event: e });
    return;
  }
  if (e.type === 'skill_invoked') {
    // Close any previous scope, then open a new one. Also collapse
    // the load_skill tool-call into the new scope so we don't show
    // both "load_skill(name=foo)" AND "◆ skill: foo".
    closeOpenScope();
    s.continuationSkillEvent = null;
    if (s.pendingLoadSkillCallId) {
      s.suppressedCallIds.add(s.pendingLoadSkillCallId);
      removeBlockByCallId(s.pendingLoadSkillCallId);
      s.pendingLoadSkillCallId = null;
    }
    s.subagentGroup.current = null;
    s.openScope = {
      kind: 'skill-scope',
      id: e.id,
      skillEvent: e,
      children: [],
      closed: false,
    };
    s.root.push(s.openScope);
    return;
  }
  if (e.type === 'tool_call_requested') {
    if (e.name === 'load_skill') {
      s.pendingLoadSkillCallId = e.callId;
    }
    // A skill scope was closed by an interleaved assistant_message
    // and a fresh tool call has now arrived. Reopen the scope so the
    // continuation tools stay visually grouped under the same skill
    // banner, just below the assistant text in chronological order.
    if (!s.openScope && s.continuationSkillEvent) {
      s.openScope = {
        kind: 'skill-scope',
        id: `${s.continuationSkillEvent.id}:cont:${e.id}`,
        skillEvent: s.continuationSkillEvent,
        children: [],
        closed: false,
      };
      s.root.push(s.openScope);
      s.continuationSkillEvent = null;
    }
    // File-edit tools never aggregate — each renders its own diff inline.
    const compact = FILE_DIFF_TOOL_NAMES.has(e.name) ? undefined : s.compactByName.get(e.name);
    if (compact) {
      // Compact tool — aggregate into an open live block, or start one.
      if (!s.openLive) {
        s.openLive = { kind: 'live-tools', id: e.id, calls: [], closed: false };
        pushBlock(s.openLive);
      }
      const call: LiveToolCall = { id: e.id, request: e, compact, outcome: null };
      s.openLive.calls.push(call);
      s.callTargets.set(e.callId, call);
      return;
    }
    // Verbose tool — seal any open live block first so it stops accreting.
    closeOpenLive();
    const block: ToolCallBlockData = {
      kind: 'tool-call',
      id: e.id,
      request: e,
      outcome: null,
    };
    s.callTargets.set(e.callId, block);
    pushBlock(block);
    return;
  }
  if (e.type === 'tool_result') {
    if (s.suppressedCallIds.has(e.callId)) return;
    const target = s.callTargets.get(e.callId);
    if (target) {
      target.outcome = e;
      return;
    }
  }
  if (e.type === 'tool_call_denied') {
    if (s.suppressedCallIds.has(e.callId)) return;
    const target = s.callTargets.get(e.callId);
    if (target) {
      target.outcome = { type: 'denied', reason: e.reason };
      return;
    }
  }
  if (e.type === 'tool_call_approved') {
    return; // outcome already conveys this
  }
  if (e.type === 'assistant_message') {
    closeOpenLive();
    // Assistant messages always render at the chat's left margin,
    // even when a skill scope is open above them. The scope groups
    // skill tool work; the assistant's commentary surrounding that
    // work belongs at root so its bullet aligns with the rest of the
    // conversation — and so post-stream rendering matches the
    // streaming preview, which already lives at root.
    //
    // If a skill scope is currently open, close it so subsequent
    // tool calls form a continuation block BELOW this message. Without
    // this split, late tool calls fold back into the original scope
    // (a child push above) and the message visually drops below the
    // entire skill block instead of slotting in chronologically.
    if (s.openScope) {
      s.continuationSkillEvent = s.openScope.skillEvent;
      s.openScope.closed = true;
      s.openScope = null;
    } else {
      // A second consecutive assistant_message (no skill scope open and no
      // intervening tool call) means the one-message continuation window has
      // passed. Clear it so later tool calls don't get pulled back under a
      // stale skill banner two messages later.
      s.continuationSkillEvent = null;
    }
    s.subagentGroup.current = null;
    s.root.push({ kind: 'event', id: e.id, event: e });
    return;
  }
  // Subagent events fold into a collapsible group so a fleet of children
  // doesn't drown the main chat. The SubagentSpawner emits them as
  // plugin_event with pluginId='@moxxy/subagents'.
  if (e.type === 'plugin_event' && e.pluginId === SUBAGENT_PLUGIN_ID) {
    handleSubagentEvent(e, s.subagents, s.root, s.subagentGroup);
    return;
  }
  // Collaborative-run events fold into one team-level block (roster, bus,
  // board, contracts, control, outcome) instead of N generic event rows.
  if (e.type === 'plugin_event' && e.pluginId === COLLAB_PLUGIN_ID) {
    handleCollabEvent(e, s.collab, s.root);
    return;
  }
  pushBlock({ kind: 'event', id: e.id, event: e });
}

export function pairToolEvents(
  events: ReadonlyArray<MoxxyEvent>,
  compactByName: CompactToolMap = EMPTY_COMPACT_MAP,
): Block[] {
  const state = createFoldState(compactByName);
  for (const e of events) stepFold(state, e);
  return state.root;
}

/**
 * Incremental block fold: keep the {@link FoldState} alive across calls and
 * apply each newly-committed event with {@link stepFold}, so the growing
 * settled prefix of the tree is folded exactly ONCE instead of being
 * re-walked from index 0 on every event (the old O(n²)/turn behaviour).
 *
 * `tree()` returns the SAME `root` reference each call (it mutates in place
 * as outcomes settle and scopes close), so callers MUST treat it as
 * read-only and re-derive their own snapshot identity from `version`.
 *
 * Correctness contract: for any event prefix, `push`-ing those events one at
 * a time and reading `tree()` yields a block tree byte-identical to
 * `pairToolEvents(prefix, compactByName)` — both drive the same `stepFold`
 * over the same events in the same order. A golden test asserts this
 * deep-equality after every event across many recorded sequences.
 */
export class IncrementalFold {
  private state: FoldState;
  private prefixLength = 0;
  private rev = 0;
  /** `id` of the first / last event folded so far — used to detect when the
   *  source array's prefix has shifted (a scroll-up prepend) or been replaced
   *  (/clear, a fresh session), in which case the carried fold state is no
   *  longer valid and we must rebuild from scratch. */
  private headId: string | null = null;
  private tailId: string | null = null;

  constructor(compactByName: CompactToolMap = EMPTY_COMPACT_MAP) {
    this.state = createFoldState(compactByName);
  }

  /** Number of events folded so far (the high-water mark). */
  get length(): number {
    return this.prefixLength;
  }

  /** Bumps whenever the folded tree may have changed (every `push`). Use as
   *  a memo key instead of the (stable) `tree()` reference. */
  get version(): number {
    return this.rev;
  }

  /** Fold one freshly-committed event onto the existing tree. */
  push(event: MoxxyEvent): void {
    stepFold(this.state, event);
    if (this.prefixLength === 0) this.headId = event.id;
    this.tailId = event.id;
    this.prefixLength += 1;
    this.rev += 1;
  }

  /** Fold a batch of newly-committed events (e.g. a replayed page). */
  pushMany(events: ReadonlyArray<MoxxyEvent>): void {
    for (const e of events) this.push(e);
  }

  /**
   * Re-sync to `events` when the source array is the authoritative log. Folds
   * only the tail past the current high-water mark when `events` extends the
   * already-folded prefix unchanged (the common live-append case), and
   * rebuilds from scratch only when that prefix shifted or was replaced (a
   * scroll-up prepend, /clear, a fresh session). Returns the (stable) root.
   *
   * Prefix-unchanged is detected by event `id`: the log never rewrites a
   * settled event in place (only its tool outcome, which the fold owns), so
   * matching head+tail ids over an unshrunk length proves the leading
   * `prefixLength` events are exactly the ones already folded.
   */
  syncTo(events: ReadonlyArray<MoxxyEvent>): Block[] {
    if (this.canExtend(events)) {
      for (let i = this.prefixLength; i < events.length; i += 1) this.push(events[i]!);
      return this.state.root;
    }
    // The known prefix changed (or shrank): the carry is no longer valid, so
    // re-fold from scratch. Rare relative to live appends.
    this.reset();
    this.pushMany(events);
    return this.state.root;
  }

  /** Discard all state — folds again from empty. */
  reset(): void {
    this.state = createFoldState(this.state.compactByName);
    this.prefixLength = 0;
    this.headId = null;
    this.tailId = null;
    this.rev += 1;
  }

  /** The folded block tree (stable reference, mutated in place). */
  tree(): Block[] {
    return this.state.root;
  }

  /** True when `events` is the already-folded prefix plus zero or more new
   *  tail events — i.e. a pure append. Requires the head id to still match
   *  (no prepend) and the event at `prefixLength-1` to be the last one we
   *  folded (no in-place rewrite or replacement of the prefix). */
  private canExtend(events: ReadonlyArray<MoxxyEvent>): boolean {
    if (this.prefixLength === 0) return true; // empty fold extends to anything
    if (events.length < this.prefixLength) return false; // shrank → rebuild
    if (events[0]!.id !== this.headId) return false; // head shifted (prepend)
    return events[this.prefixLength - 1]!.id === this.tailId;
  }
}

/**
 * A block is "settled" once nothing in its render will change anymore.
 * Static-rendered items are frozen, so this gate must be conservative:
 * pending tool calls (animated dot), open skill scopes (children still
 * arriving), and running subagents (live elapsed counter) all stay in
 * the dynamic area until they finish.
 */
export function isSettled(block: Block): boolean {
  if (block.kind === 'event') return true;
  if (block.kind === 'tool-call') return block.outcome !== null;
  if (block.kind === 'subagent') return block.completedAtMs !== null || block.error !== null;
  if (block.kind === 'subagent-group') return block.agents.every(isSettled);
  if (block.kind === 'collab') return block.completedAtMs !== null;
  if (block.kind === 'skill-scope') {
    return block.closed && block.children.every(isSettled);
  }
  if (block.kind === 'live-tools') {
    return block.closed && block.calls.every((c) => c.outcome !== null);
  }
  return true;
}

/**
 * Shallow-but-typed equality for the fields each block kind renders.
 * Returning true means "skip this re-render" — be conservative: when in
 * doubt, return false (correctness over perf). Identity check is the
 * fast path; the per-kind logic only runs when references differ.
 */
export function blocksEquivalent(a: Block, b: Block): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'event' && b.kind === 'event') {
    return a.event === b.event;
  }
  if (a.kind === 'tool-call' && b.kind === 'tool-call') {
    return a.request === b.request && a.outcome === b.outcome;
  }
  if (a.kind === 'subagent' && b.kind === 'subagent') {
    // Subagent updates: tool count, tokens, completion timestamp, preview, error.
    return (
      a.completedAtMs === b.completedAtMs &&
      a.toolCallCount === b.toolCallCount &&
      a.tokensUsed === b.tokensUsed &&
      a.finalPreview === b.finalPreview &&
      a.error === b.error
    );
  }
  if (a.kind === 'subagent-group' && b.kind === 'subagent-group') {
    if (a.agentType !== b.agentType) return false;
    if (a.agents.length !== b.agents.length) return false;
    for (let i = 0; i < a.agents.length; i += 1) {
      if (!blocksEquivalent(a.agents[i]!, b.agents[i]!)) return false;
    }
    return true;
  }
  if (a.kind === 'skill-scope' && b.kind === 'skill-scope') {
    if (a.closed !== b.closed) return false;
    if (a.children.length !== b.children.length) return false;
    for (let i = 0; i < a.children.length; i += 1) {
      if (!blocksEquivalent(a.children[i]!, b.children[i]!)) return false;
    }
    return true;
  }
  if (a.kind === 'collab' && b.kind === 'collab') {
    // Cheap change signals — be conservative (re-render on any team change).
    return (
      a.completedAtMs === b.completedAtMs &&
      a.fallbackReason === b.fallbackReason &&
      a.agents.length === b.agents.length &&
      a.messages.length === b.messages.length &&
      a.tasks.length === b.tasks.length &&
      a.contracts.length === b.contracts.length &&
      a.conflicts.length === b.conflicts.length &&
      a.control?.paused === b.control?.paused &&
      a.control?.directive === b.control?.directive &&
      a.agents.map((x) => x.status).join(',') === b.agents.map((x) => x.status).join(',') &&
      a.tasks.map((x) => x.status).join(',') === b.tasks.map((x) => x.status).join(',') &&
      a.contracts.map((x) => `${x.status}${x.version}`).join(',') ===
        b.contracts.map((x) => `${x.status}${x.version}`).join(',')
    );
  }
  if (a.kind === 'live-tools' && b.kind === 'live-tools') {
    if (a.closed !== b.closed) return false;
    if (a.calls.length !== b.calls.length) return false;
    for (let i = 0; i < a.calls.length; i += 1) {
      if (a.calls[i]!.outcome !== b.calls[i]!.outcome) return false;
      if (a.calls[i]!.request !== b.calls[i]!.request) return false;
    }
    return true;
  }
  return false;
}

export function countToolCalls(blocks: ReadonlyArray<Block>): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind === 'tool-call') n += 1;
    else if (b.kind === 'skill-scope') n += countToolCalls(b.children);
    else if (b.kind === 'live-tools') n += b.calls.length;
    else if (b.kind === 'subagent-group') {
      for (const a of b.agents) n += a.toolCallCount;
    }
  }
  return n;
}

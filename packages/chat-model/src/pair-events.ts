import type { MoxxyEvent, PluginEvent, ToolCompactPresentation } from '@moxxy/sdk';
import { isFileDiffDisplay } from '@moxxy/sdk/tool-display';
import type {
  Block,
  LiveToolBlockData,
  LiveToolCall,
  SkillScopeBlock,
  SubagentBlock,
  SubagentGroupBlock,
  ToolCallBlockData,
} from './types.js';
import { oneLine } from './format.js';

const SUBAGENT_PLUGIN_ID = '@moxxy/subagents';

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

export function pairToolEvents(
  events: ReadonlyArray<MoxxyEvent>,
  compactByName: CompactToolMap = EMPTY_COMPACT_MAP,
): Block[] {
  const root: Block[] = [];
  // Reverse lookup: callId → the outcome-holder for that call (either a
  // ToolCallBlockData or a LiveToolCall — both have a mutable `outcome`
  // field). One map handles both kinds via structural typing.
  const callTargets = new Map<string, CallTarget>();
  const suppressedCallIds = new Set<string>();
  let pendingLoadSkillCallId: string | null = null;
  let openScope: SkillScopeBlock | null = null;
  // When an assistant_message lands mid-skill we close the current
  // scope so the message renders below the tools that preceded it
  // (preserving chronological order). If more skill tool calls come
  // afterwards, we open a continuation scope tagged with the same
  // skillEvent so the grouping carries through both visually and via
  // `countToolCalls`. Cleared at turn boundaries and on a new
  // skill_invoked.
  let continuationSkillEvent: import('@moxxy/sdk').SkillInvokedEvent | null = null;
  // Open live-tools aggregate, if any. Lives at the current push level
  // (root or openScope.children); subsequent compact tool calls append
  // into it until something non-compact closes it.
  let openLive: LiveToolBlockData | null = null;
  const subagents = new Map<string, SubagentBlock>();
  // Open subagent group, if any. Consecutive `subagent_started` events accrete
  // into it; any non-subagent block (or a turn/scope boundary) closes the run.
  const subagentGroup: { current: SubagentGroupBlock | null } = { current: null };

  const pushBlock = (block: Block): void => {
    // Any non-subagent block breaks a run of sibling subagents.
    subagentGroup.current = null;
    if (openScope) {
      openScope.children.push(block);
    } else {
      root.push(block);
    }
  };

  const closeOpenLive = (): void => {
    if (openLive) {
      openLive.closed = true;
      openLive = null;
    }
  };

  const closeOpenScope = (): void => {
    closeOpenLive();
    if (openScope) {
      openScope.closed = true;
      openScope = null;
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
    if (openScope && removeFrom(openScope.children)) return;
    removeFrom(root);
  };

  // UI safety net: when a new user_prompt arrives, any tool-call block
  // still showing `outcome: null` is an orphan — its result event never
  // landed. Mark it as a synthetic error so the dot stops pulsing forever
  // and the user can see *something* went wrong. The upstream modes should
  // synthesize tool_result events for these cases (and now do), but this
  // guard means a future regression can't leave a permanent stuck dot.
  const markOrphansAtTurnBoundary = (): void => {
    for (const target of callTargets.values()) {
      if (target.outcome === null) {
        target.outcome = {
          type: 'denied',
          reason: 'no result recorded before next turn — likely interrupted or lost',
        };
      }
    }
    callTargets.clear();
  };

  for (const e of events) {
    if (e.type === 'user_prompt') {
      closeOpenScope();
      markOrphansAtTurnBoundary();
      pendingLoadSkillCallId = null;
      continuationSkillEvent = null;
      // Suppression is a within-turn concern (a load_skill call folded into a
      // skill scope). Clearing it at the turn boundary stops a later turn that
      // happens to reuse a callId from having its tool_result silently dropped.
      suppressedCallIds.clear();
      subagentGroup.current = null;
      root.push({ kind: 'event', id: e.id, event: e });
      continue;
    }
    if (e.type === 'skill_invoked') {
      // Close any previous scope, then open a new one. Also collapse
      // the load_skill tool-call into the new scope so we don't show
      // both "load_skill(name=foo)" AND "◆ skill: foo".
      closeOpenScope();
      continuationSkillEvent = null;
      if (pendingLoadSkillCallId) {
        suppressedCallIds.add(pendingLoadSkillCallId);
        removeBlockByCallId(pendingLoadSkillCallId);
        pendingLoadSkillCallId = null;
      }
      subagentGroup.current = null;
      openScope = {
        kind: 'skill-scope',
        id: e.id,
        skillEvent: e,
        children: [],
        closed: false,
      };
      root.push(openScope);
      continue;
    }
    if (e.type === 'tool_call_requested') {
      if (e.name === 'load_skill') {
        pendingLoadSkillCallId = e.callId;
      }
      // A skill scope was closed by an interleaved assistant_message
      // and a fresh tool call has now arrived. Reopen the scope so the
      // continuation tools stay visually grouped under the same skill
      // banner, just below the assistant text in chronological order.
      if (!openScope && continuationSkillEvent) {
        openScope = {
          kind: 'skill-scope',
          id: `${continuationSkillEvent.id}:cont:${e.id}`,
          skillEvent: continuationSkillEvent,
          children: [],
          closed: false,
        };
        root.push(openScope);
        continuationSkillEvent = null;
      }
      // File-edit tools never aggregate — each renders its own diff inline.
      const compact = FILE_DIFF_TOOL_NAMES.has(e.name) ? undefined : compactByName.get(e.name);
      if (compact) {
        // Compact tool — aggregate into an open live block, or start one.
        if (!openLive) {
          openLive = { kind: 'live-tools', id: e.id, calls: [], closed: false };
          pushBlock(openLive);
        }
        const call: LiveToolCall = { id: e.id, request: e, compact, outcome: null };
        openLive.calls.push(call);
        callTargets.set(e.callId, call);
        continue;
      }
      // Verbose tool — seal any open live block first so it stops accreting.
      closeOpenLive();
      const block: ToolCallBlockData = {
        kind: 'tool-call',
        id: e.id,
        request: e,
        outcome: null,
      };
      callTargets.set(e.callId, block);
      pushBlock(block);
      continue;
    }
    if (e.type === 'tool_result') {
      if (suppressedCallIds.has(e.callId)) continue;
      const target = callTargets.get(e.callId);
      if (target) {
        target.outcome = e;
        continue;
      }
    }
    if (e.type === 'tool_call_denied') {
      if (suppressedCallIds.has(e.callId)) continue;
      const target = callTargets.get(e.callId);
      if (target) {
        target.outcome = { type: 'denied', reason: e.reason };
        continue;
      }
    }
    if (e.type === 'tool_call_approved') {
      continue; // outcome already conveys this
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
      if (openScope) {
        continuationSkillEvent = openScope.skillEvent;
        openScope.closed = true;
        openScope = null;
      } else {
        // A second consecutive assistant_message (no skill scope open and no
        // intervening tool call) means the one-message continuation window has
        // passed. Clear it so later tool calls don't get pulled back under a
        // stale skill banner two messages later.
        continuationSkillEvent = null;
      }
      subagentGroup.current = null;
      root.push({ kind: 'event', id: e.id, event: e });
      continue;
    }
    // Subagent events fold into a collapsible group so a fleet of children
    // doesn't drown the main chat. The SubagentSpawner emits them as
    // plugin_event with pluginId='@moxxy/subagents'.
    if (e.type === 'plugin_event' && e.pluginId === SUBAGENT_PLUGIN_ID) {
      handleSubagentEvent(e, subagents, root, subagentGroup);
      continue;
    }
    pushBlock({ kind: 'event', id: e.id, event: e });
  }
  return root;
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

import type { MoxxyEvent } from '@moxxy/sdk';
import type { Block, SkillScopeBlock, SubagentBlock, ToolCallBlockData } from './types.js';
import { oneLine } from './format.js';

const SUBAGENT_PLUGIN_ID = '@moxxy/subagents';

export function pairToolEvents(events: ReadonlyArray<MoxxyEvent>): Block[] {
  const root: Block[] = [];
  // Reverse lookup: callId → the tool-call block currently waiting on a
  // result/denied event. Lookup works whether the block sits in `root`
  // or inside an open skill scope.
  const callBlocks = new Map<string, ToolCallBlockData>();
  const suppressedCallIds = new Set<string>();
  let pendingLoadSkillCallId: string | null = null;
  // Active skill scope (children get pushed here instead of root).
  let openScope: SkillScopeBlock | null = null;
  // Live subagent blocks keyed by their childSessionId so subsequent
  // tool-call / completed events from the spawner can attach to the
  // right block.
  const subagents = new Map<string, SubagentBlock>();

  const pushBlock = (block: Block): void => {
    if (openScope) {
      openScope.children.push(block);
    } else {
      root.push(block);
    }
  };

  const closeOpenScope = (): void => {
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
  // and the user can see *something* went wrong. The upstream loops should
  // synthesize tool_result events for these cases (and now do), but this
  // guard means a future regression can't leave a permanent stuck dot.
  const markOrphansAtTurnBoundary = (): void => {
    for (const block of callBlocks.values()) {
      if (block.outcome === null) {
        block.outcome = {
          type: 'denied',
          reason: 'no result recorded before next turn — likely interrupted or lost',
        };
      }
    }
    callBlocks.clear();
  };

  for (const e of events) {
    if (e.type === 'user_prompt') {
      closeOpenScope();
      markOrphansAtTurnBoundary();
      pendingLoadSkillCallId = null;
      root.push({ kind: 'event', id: e.id, event: e });
      continue;
    }
    if (e.type === 'skill_invoked') {
      // Close any previous scope, then open a new one. Also collapse
      // the load_skill tool-call into the new scope so we don't show
      // both "load_skill(name=foo)" AND "◆ skill: foo".
      closeOpenScope();
      if (pendingLoadSkillCallId) {
        suppressedCallIds.add(pendingLoadSkillCallId);
        removeBlockByCallId(pendingLoadSkillCallId);
        pendingLoadSkillCallId = null;
      }
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
      const block: ToolCallBlockData = {
        kind: 'tool-call',
        id: e.id,
        request: e,
        outcome: null,
      };
      callBlocks.set(e.callId, block);
      pushBlock(block);
      continue;
    }
    if (e.type === 'tool_result') {
      if (suppressedCallIds.has(e.callId)) continue;
      const block = callBlocks.get(e.callId);
      if (block) {
        block.outcome = e;
        continue;
      }
    }
    if (e.type === 'tool_call_denied') {
      if (suppressedCallIds.has(e.callId)) continue;
      const block = callBlocks.get(e.callId);
      if (block) {
        block.outcome = { type: 'denied', reason: e.reason };
        continue;
      }
    }
    if (e.type === 'tool_call_approved') {
      continue; // outcome already conveys this
    }
    if (e.type === 'assistant_message') {
      // Assistant messages always render at the chat's left margin,
      // even when a skill scope is open above them. The scope groups
      // skill tool work; the assistant's commentary surrounding that
      // work belongs at root so its bullet aligns with the rest of the
      // conversation — and so post-stream rendering matches the
      // streaming preview, which already lives at root.
      root.push({ kind: 'event', id: e.id, event: e });
      continue;
    }
    // Subagent events fold into one-line scope blocks so a fleet of
    // children doesn't drown the main chat. The SubagentSpawner emits
    // them as plugin_event with pluginId='@moxxy/subagents'.
    if (e.type === 'plugin_event' && e.pluginId === SUBAGENT_PLUGIN_ID) {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      const childSessionId = String(payload.childSessionId ?? '');
      if (!childSessionId) continue;
      if (e.subtype === 'subagent_started') {
        const block: SubagentBlock = {
          kind: 'subagent',
          id: e.id,
          childSessionId,
          label: String(payload.label ?? 'agent'),
          startedAtMs: new Date(e.ts).getTime(),
          completedAtMs: null,
          toolCallCount: 0,
          stopReason: null,
          finalPreview: null,
          error: null,
        };
        subagents.set(childSessionId, block);
        pushBlock(block);
        continue;
      }
      const block = subagents.get(childSessionId);
      if (!block) continue;
      if (e.subtype === 'subagent_tool_call') {
        block.toolCallCount += 1;
        continue;
      }
      if (e.subtype === 'subagent_completed') {
        block.completedAtMs = new Date(e.ts).getTime();
        block.stopReason = String(payload.stopReason ?? '');
        const text = typeof payload.text === 'string' ? payload.text : '';
        if (text) block.finalPreview = oneLine(text);
        if (typeof payload.error === 'string') block.error = payload.error;
        continue;
      }
      if (e.subtype === 'subagent_error' || e.subtype === 'subagent_abort') {
        block.completedAtMs = new Date(e.ts).getTime();
        const reason =
          (typeof payload.message === 'string' && payload.message) ||
          (typeof payload.reason === 'string' && payload.reason) ||
          'aborted';
        block.error = reason;
        continue;
      }
      // chunk / tool_result / nested-grand-child: ignore at top level;
      // the /agents modal exposes the raw stream when needed.
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
  if (block.kind === 'skill-scope') {
    return block.closed && block.children.every(isSettled);
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
    // Subagent updates: tool count, completion timestamp, preview, error.
    return (
      a.completedAtMs === b.completedAtMs &&
      a.toolCallCount === b.toolCallCount &&
      a.finalPreview === b.finalPreview &&
      a.error === b.error
    );
  }
  if (a.kind === 'skill-scope' && b.kind === 'skill-scope') {
    if (a.closed !== b.closed) return false;
    if (a.children.length !== b.children.length) return false;
    for (let i = 0; i < a.children.length; i += 1) {
      if (!blocksEquivalent(a.children[i]!, b.children[i]!)) return false;
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
  }
  return n;
}

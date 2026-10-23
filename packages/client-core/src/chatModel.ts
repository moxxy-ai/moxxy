/**
 * Desktop chat model. Replaces the old flat-Block reducer with the
 * shared @moxxy/chat-model fold: the store keeps an append-only log of
 * the *committed* runner events, the in-flight assistant text lives in a
 * separate `streamingText` string (so a streaming chunk is O(1) and
 * never re-folds the log), and the render tree is derived by
 * `pairToolEvents` over a window of events — exactly how the TUI's
 * ChatView separates settled events from the live preview.
 *
 * Desktop-only timeline cards that are NOT runner events (slash-command
 * result cards, local notices) live in a small `extensions` array,
 * anchored by the event count at insertion so they render in order.
 * They are ephemeral — not part of the persisted event log.
 *
 * Kept React-free so the runtime can be driven directly by tests.
 */

import type { MoxxyEvent, ReasoningMessageEvent } from '@moxxy/sdk';
import { accountLimitOfEvent } from '@moxxy/sdk/agent-account-limit';
import { isAgentNoReplyEvent } from '@moxxy/sdk/agent-no-reply';
import { QUESTION_PLUGIN_ID } from '@moxxy/sdk/questions';
import {
  ChunkedBlockLog,
  FILE_DIFF_TOOL_NAMES,
  isAgentWorkEvent,
  newBlockId,
  pairToolEvents,
  questionAnswerOf,
  type Block as FoldedBlock,
  type CompactToolMap,
  type IncrementalFold,
  type ToolCallBlockData,
} from '@moxxy/chat-model';

export type { FoldedBlock };

/** Slash-command result card or a locally-generated notice — desktop UI
 *  that has no corresponding runner event. `afterCount` anchors it after
 *  the Nth committed event so it renders in chronological order. */
export type Extension =
  | {
      readonly kind: 'action_result';
      readonly id: string;
      readonly afterCount: number;
      readonly commandName: string;
      readonly argsLine: string;
      readonly tone: 'info' | 'error' | 'notice';
      readonly text: string;
    }
  | {
      readonly kind: 'notice';
      readonly id: string;
      readonly afterCount: number;
      readonly tone: 'info' | 'error';
      readonly text: string;
    };

/** One node of the rendered transcript: a folded chat-model block, a desktop
 *  extension card, or a run of ≥2 consecutive standalone tool calls collapsed
 *  into one group (see {@link groupToolNodes}). */
export type RenderNode =
  | { readonly kind: 'block'; readonly block: FoldedBlock }
  | { readonly kind: 'ext'; readonly ext: Extension }
  | { readonly kind: 'tool-group'; readonly id: string; readonly tools: ReadonlyArray<ToolCallBlockData> }
  | { readonly kind: 'thinking'; readonly id: string; readonly events: ReadonlyArray<ReasoningMessageEvent> }
  | WorkNode;

/**
 * What an agent did on its way to an answer in one finished turn (thoughts,
 * tool runs, the comments in between), folded into one row: see `groupWorkNodes`.
 */
export interface WorkNode {
  readonly kind: 'work';
  readonly id: string;
  readonly nodes: ReadonlyArray<RenderNode>;
  /** Tool calls, thoughts and comments the group holds. */
  readonly steps: number;
  /** From the turn's message (or the first step), to whatever came after the last step. */
  readonly startedAtMs: number | null;
  readonly endedAtMs: number | null;
}

function reasoningOf(node: RenderNode): ReasoningMessageEvent | null {
  if (node.kind !== 'block' || node.block.kind !== 'event') return null;
  return node.block.event.type === 'reasoning_message' ? node.block.event : null;
}

/**
 * Fold runs of ≥2 consecutive "Thinking" blocks into one `thinking` node: an
 * agent that thinks between every step would otherwise stack a row per
 * thought. Anything else, a tool included, breaks the run.
 */
export function groupThinkingNodes(nodes: ReadonlyArray<RenderNode>): RenderNode[] {
  const out: RenderNode[] = [];
  let run: RenderNode[] = [];
  const flush = (): void => {
    const first = run[0];
    if (first && run.length >= 2 && first.kind === 'block') {
      out.push({ kind: 'thinking', id: `thinking:${first.block.id}`, events: run.flatMap((node) => reasoningOf(node) ?? []) });
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const node of nodes) {
    if (reasoningOf(node)) {
      run.push(node);
    } else {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}

function eventOf(node: RenderNode): MoxxyEvent | null {
  return node.kind === 'block' && node.block.kind === 'event' ? node.block.event : null;
}

/** A row that is part of an agent's work; anything else (errors, Stopped, notices, cards) stays in view. */
function isWorkStep(node: RenderNode): boolean {
  if (node.kind === 'thinking') return true;
  if (node.kind === 'tool-group') return !node.tools.some((tool) => questionAnswerOf(tool.outcome));
  if (node.kind !== 'block') return false;
  const block = node.block;
  if (block.kind === 'tool-call') return !questionAnswerOf(block.outcome);
  if (block.kind === 'event') return block.event.type === 'assistant_message' || block.event.type === 'reasoning_message';
  return block.kind === 'live-tools' || block.kind === 'skill-scope' || block.kind === 'subagent' || block.kind === 'subagent-group';
}

function stepsIn(node: RenderNode): number {
  if (node.kind === 'tool-group') return node.tools.length;
  if (node.kind === 'thinking') return node.events.length;
  if (node.kind === 'block' && node.block.kind === 'live-tools') return node.block.calls.length;
  if (node.kind === 'block' && node.block.kind === 'subagent-group') return node.block.agents.length;
  return 1;
}

function startOf(node: RenderNode): number | null {
  const ts = (() => {
    if (node.kind === 'tool-group') return node.tools[0]?.request.ts;
    if (node.kind === 'thinking') return node.events[0]?.ts;
    if (node.kind !== 'block') return undefined;
    const block = node.block;
    if (block.kind === 'event') return block.event.ts;
    if (block.kind === 'tool-call') return block.request.ts;
    if (block.kind === 'live-tools') return block.calls[0]?.request.ts;
    if (block.kind === 'skill-scope') return block.skillEvent.ts;
    if (block.kind === 'subagent') return block.startedAtMs;
    if (block.kind === 'subagent-group') return block.agents[0]?.startedAtMs;
    return undefined;
  })();
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
}

/** The latest moment a row records: its start, or the last result it got. */
function endOf(node: RenderNode): number | null {
  const calls =
    node.kind === 'tool-group' ? node.tools
    : node.kind === 'block' && node.block.kind === 'tool-call' ? [node.block]
    : node.kind === 'block' && node.block.kind === 'live-tools' ? node.block.calls
    : [];
  const ends = calls.flatMap((call) => (call.outcome && call.outcome.type !== 'denied' ? [call.outcome.ts] : []));
  if (node.kind === 'thinking') ends.push(...node.events.map((event) => event.ts));
  const start = startOf(node);
  if (start !== null) ends.push(start);
  const finite = ends.filter((ts) => Number.isFinite(ts));
  return finite.length > 0 ? Math.max(...finite) : null;
}

export interface WorkGroupOptions {
  /** The last turn is still going: its steps stay in view as they come. */
  readonly running?: boolean;
  /** A row the surface draws as more than a step, such as a plan card: never folded. */
  readonly keep?: (node: RenderNode) => boolean;
}

/**
 * Fold what an agent did in each finished turn before its answer into one
 * `work` row, so a long piece of work reads as "worked 4m · 12 steps" over the
 * answer instead of a screen of comments, thoughts and tool runs.
 *
 * A turn runs from one person's (or agent-started) message to the next. Its
 * last message stays in view as the answer; errors, Stopped, notices, answered
 * questions, step lists and whatever `keep` names stay in view too, so the
 * work folds in runs between them, in order. A run of one step stays as it is,
 * and the turn still running is left alone.
 */
export function groupWorkNodes(nodes: ReadonlyArray<RenderNode>, options: WorkGroupOptions = {}): RenderNode[] {
  const keep = options.keep ?? (() => false);
  const prompts = nodes.flatMap((node, at) => (eventOf(node)?.type === 'user_prompt' ? [at] : []));
  const out: RenderNode[] = [...nodes.slice(0, prompts[0] ?? nodes.length)];
  prompts.forEach((from, index) => {
    const to = prompts[index + 1] ?? nodes.length;
    const turn = nodes.slice(from, to);
    const isLast = index === prompts.length - 1;
    if (isLast && options.running) {
      out.push(...turn);
      return;
    }
    const answerAt = turn.findLastIndex((node) => eventOf(node)?.type === 'assistant_message' && !keep(node));
    const turnStart = startOf(turn[0]!);
    let run: RenderNode[] = [];
    const flush = (next: RenderNode | undefined): void => {
      const first = run[0];
      if (first && run.length >= 2) {
        const startedFirst = out.at(-1) === turn[0];
        const ends = run.map(endOf).filter((ts): ts is number => ts !== null);
        out.push({
          kind: 'work',
          id: `work:${keyOfNode(first)}`,
          nodes: run,
          steps: run.reduce((sum, node) => sum + stepsIn(node), 0),
          startedAtMs: (startedFirst ? turnStart : null) ?? startOf(first),
          endedAtMs: (next ? startOf(next) : null) ?? (ends.length > 0 ? Math.max(...ends) : null),
        });
      } else {
        out.push(...run);
      }
      run = [];
    };
    out.push(turn[0]!);
    turn.slice(1).forEach((node, at) => {
      if (at + 1 !== answerAt && isWorkStep(node) && !keep(node)) {
        run.push(node);
      } else {
        flush(node);
        out.push(node);
      }
    });
    flush(undefined);
  });
  return out;
}

/** The id a row is known by, stable while the row stays the same. */
export function keyOfNode(node: RenderNode): string {
  if (node.kind === 'ext') return node.ext.id;
  if (node.kind === 'block') return node.block.id;
  return node.id;
}

/**
 * Collapse runs of ≥2 consecutive top-level `tool-call` nodes into a single
 * `tool-group` node so a burst of back-to-back Writes/fetches reads as one
 * collapsible "Tools (N)" block instead of N stacked rows. A lone tool keeps
 * its own top-level block; anything non-tool (assistant text, a skill scope,
 * an extension) breaks the run.
 */
export function groupToolNodes(nodes: ReadonlyArray<RenderNode>): RenderNode[] {
  const out: RenderNode[] = [];
  let run: ToolCallBlockData[] = [];
  const flush = (): void => {
    const first = run[0];
    if (first) {
      if (run.length >= 2) {
        out.push({ kind: 'tool-group', id: `toolgroup:${first.id}`, tools: run });
      } else {
        out.push({ kind: 'block', block: first });
      }
    }
    run = [];
  };
  for (const n of nodes) {
    // File edits (Write/Edit) render as their own diff card — never folded
    // into a "Tools · N" group — so the diff preview stays visible inline.
    if (
      n.kind === 'block' &&
      n.block.kind === 'tool-call' &&
      !FILE_DIFF_TOOL_NAMES.has(n.block.request.name)
    ) {
      run.push(n.block);
    } else {
      flush();
      out.push(n);
    }
  }
  flush();
  return out;
}

export type ChatAction =
  | { type: 'event'; event: MoxxyEvent }
  | { type: 'send_started'; turnId: string }
  | { type: 'send_failed'; message: string }
  | { type: 'turn_reconciled_idle' }
  | { type: 'turn_complete'; turnId: string; error: string | null }
  | {
      type: 'action_result';
      commandName: string;
      argsLine: string;
      tone: 'info' | 'error' | 'notice';
      text: string;
    }
  | { type: 'dismiss_block'; blockId: string }
  | { type: 'clear' };

/**
 * Runner event types the chat surface renders. Everything else
 * (provider_request/response, mode_iteration, compaction, elision,
 * plugin_registered, …) is bookkeeping noise that would otherwise fold
 * into stray EventBlocks. `assistant_chunk` is handled separately (it
 * drives the live preview), so it is deliberately absent here.
 */
const RENDERED_EVENT_TYPES: ReadonlySet<MoxxyEvent['type']> = new Set([
  'user_prompt',
  'assistant_message',
  'tool_call_requested',
  'tool_result',
  'tool_call_approved',
  'tool_call_denied',
  'skill_invoked',
  'error',
  'abort',
  // Finalized per-call reasoning summary — committed + rendered as a collapsible
  // "Thinking" block. `reasoning_chunk` (the live delta) is handled separately.
  'reasoning_message',
]);

const SUBAGENT_PLUGIN_ID = '@moxxy/subagents';
const COLLAB_PLUGIN_ID = '@moxxy/mode-collaborative';

/**
 * Plugin ids whose `plugin_event`s are transcript-worthy. Seeded with the two
 * first-party plugins that emit rendered events; a plugin can opt its own events
 * in via {@link registerRenderablePlugin} instead of editing this module (an
 * open-for-extension seam, matching the rest of the registry-driven codebase).
 */
// Question records stay in the chat so its open Question can be read from it.
const renderablePluginIds = new Set<string>([SUBAGENT_PLUGIN_ID, COLLAB_PLUGIN_ID, QUESTION_PLUGIN_ID]);

/** Opt a plugin's `plugin_event`s into the rendered transcript. Idempotent. */
export function registerRenderablePlugin(pluginId: string): void {
  renderablePluginIds.add(pluginId);
}

/** Mutable per-workspace chat state. The log is append-only; the rest is
 *  small scalar/array state. `rev` bumps on every change for snapshot
 *  identity; `log.version` changes only when a committed event lands. */
export interface ChatRuntime {
  readonly log: ChunkedBlockLog<MoxxyEvent>;
  /**
   * Ids of every event already in the log — both appended (live / replay) and
   * prepended (pagination). The runner replays its FULL history on every attach
   * (and re-attach after a reconnect), and the renderer also seeds from the
   * durable display log, so the same event can arrive twice. This set makes
   * ingestion idempotent: a duplicate is dropped instead of re-rendered and
   * re-persisted. Kept in lockstep with the log by `applyEvent` and the store's
   * `prependFresh`.
   */
  readonly seenIds: Set<string>;
  extensions: Extension[];
  streamingText: string;
  /** Live reasoning/thinking preview for the active turn (parallels
   *  `streamingText`); cleared on the matching reasoning_message / the turn's
   *  assistant_message / turn completion. Never committed to the log. */
  streamingReasoning: string;
  activeTurnId: string | null;
  sending: boolean;
  error: string | null;
  rev: number;
}

export function uniqueEventsById(events: ReadonlyArray<MoxxyEvent>): MoxxyEvent[] {
  const seen = new Set<string>();
  const unique: MoxxyEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    unique.push(event);
  }
  return unique;
}

export function createRuntime(initialEvents: ReadonlyArray<MoxxyEvent> = []): ChatRuntime {
  const uniqueInitialEvents = uniqueEventsById(initialEvents);
  return {
    log: new ChunkedBlockLog<MoxxyEvent>(128, uniqueInitialEvents),
    seenIds: new Set(uniqueInitialEvents.map((e) => e.id)),
    extensions: [],
    streamingText: '',
    streamingReasoning: '',
    activeTurnId: null,
    sending: false,
    error: null,
    rev: 0,
  };
}

/** Should this runner event be committed to the rendered log? */
export function isRenderedEvent(event: MoxxyEvent): boolean {
  // An agent connection's account limit and its "finished without replying" show in the chat; its other records are bookkeeping.
  if (event.type === 'plugin_event') {
    return (
      renderablePluginIds.has(event.pluginId) ||
      accountLimitOfEvent(event) !== undefined ||
      isAgentNoReplyEvent(event) ||
      isAgentWorkEvent(event)
    );
  }
  return RENDERED_EVENT_TYPES.has(event.type);
}

/** Apply a runner event. Returns true if anything changed. */
export function applyEvent(rt: ChatRuntime, event: MoxxyEvent): boolean {
  if (event.type === 'assistant_chunk') {
    // O(1): accumulate into the live preview; never touches the log, so a
    // 200-chunk reply over a 2000-event log does zero array work.
    rt.streamingText += event.delta;
    rt.rev += 1;
    return true;
  }
  if (event.type === 'reasoning_chunk') {
    // Live thinking preview — accumulate ephemerally like assistant_chunk.
    rt.streamingReasoning += event.delta;
    rt.rev += 1;
    return true;
  }
  if (event.type === 'reasoning_message') {
    // Finalized reasoning summary: clear the live preview and commit it as a
    // rendered block. Drop a replayed/duplicate, still clearing any live preview.
    if (rt.seenIds.has(event.id)) {
      if (rt.streamingReasoning === '') return false;
      rt.streamingReasoning = '';
      rt.rev += 1;
      return true;
    }
    rt.log.append(event);
    rt.seenIds.add(event.id);
    rt.streamingReasoning = '';
    rt.rev += 1;
    return true;
  }
  if (event.type === 'assistant_message') {
    // Drop a replayed/duplicate message, but still clear any live streaming
    // preview it corresponds to so a re-attach mid-reply doesn't strand it.
    if (rt.seenIds.has(event.id)) {
      if (rt.streamingText === '' && rt.streamingReasoning === '') return false;
      rt.streamingText = '';
      rt.streamingReasoning = '';
      rt.rev += 1;
      return true;
    }
    rt.log.append(event);
    rt.seenIds.add(event.id);
    rt.streamingText = '';
    rt.streamingReasoning = '';
    rt.rev += 1;
    return true;
  }
  if (!isRenderedEvent(event)) return false;
  if (rt.seenIds.has(event.id)) return false; // idempotent replay/reconnect
  rt.log.append(event);
  rt.seenIds.add(event.id);
  rt.rev += 1;
  return true;
}

/** Apply a desktop UI action. Returns true if anything changed. */
export function applyAction(rt: ChatRuntime, action: ChatAction): boolean {
  switch (action.type) {
    case 'event':
      return applyEvent(rt, action.event);
    case 'send_started':
      if (rt.sending && rt.activeTurnId === action.turnId) return false;
      rt.activeTurnId = action.turnId;
      rt.sending = true;
      rt.error = null;
      rt.rev += 1;
      return true;
    case 'send_failed':
      rt.sending = false;
      rt.error = action.message;
      rt.rev += 1;
      return true;
    case 'turn_reconciled_idle':
      if (
        !rt.sending &&
        rt.activeTurnId === null &&
        rt.streamingText === '' &&
        rt.streamingReasoning === ''
      ) {
        return false;
      }
      // Runtime liveness is authoritative. Do not synthesize a terminal
      // message or error here: an interrupted pre-restart turn has no real
      // completion event, and its persisted history must remain untouched.
      rt.streamingText = '';
      rt.streamingReasoning = '';
      rt.sending = false;
      rt.activeTurnId = null;
      rt.rev += 1;
      return true;
    case 'turn_complete': {
      // Commit any streamed text the provider never sealed with an
      // assistant_message, so the reply is never lost on turn end.
      if (rt.streamingText.trim()) {
        const synth = synthAssistantMessage(rt.streamingText, action.turnId);
        rt.log.append(synth);
        rt.seenIds.add(synth.id);
      }
      rt.streamingText = '';
      rt.streamingReasoning = '';
      rt.sending = false;
      rt.activeTurnId = null;
      if (action.error) {
        rt.extensions = [
          ...rt.extensions,
          {
            kind: 'notice',
            id: newBlockId(),
            afterCount: rt.log.length,
            tone: 'error',
            text: action.error,
          },
        ];
      }
      rt.rev += 1;
      return true;
    }
    case 'action_result':
      rt.extensions = [
        ...rt.extensions,
        {
          kind: 'action_result',
          id: newBlockId(),
          afterCount: rt.log.length,
          commandName: action.commandName,
          argsLine: action.argsLine,
          tone: action.tone,
          text: action.text,
        },
      ];
      rt.rev += 1;
      return true;
    case 'dismiss_block': {
      const next = rt.extensions.filter((x) => x.id !== action.blockId);
      if (next.length === rt.extensions.length) return false;
      rt.extensions = next;
      rt.rev += 1;
      return true;
    }
    case 'clear':
      rt.log.clear();
      rt.seenIds.clear();
      rt.extensions = [];
      rt.streamingText = '';
      rt.streamingReasoning = '';
      rt.activeTurnId = null;
      rt.sending = false;
      rt.error = null;
      rt.rev += 1;
      return true;
    default:
      return false;
  }
}

/**
 * Derive the ordered render tree from a window of committed events plus
 * the extension cards. Events are folded by `pairToolEvents`; extensions
 * split the fold at their anchor so they slot in chronologically.
 * Because an extension's `afterCount` is the log length when it was
 * added, a tool call and its result (same turn) are never split across a
 * boundary.
 */
export function buildRenderNodes(
  events: ReadonlyArray<MoxxyEvent>,
  extensions: ReadonlyArray<Extension>,
  /**
   * Optional incremental fold owned by the caller (the chat store / Transcript)
   * and reused across committed events. When supplied AND no extension splits
   * the event log, the fold is extended by only its unsettled tail instead of
   * re-folding the whole array from index 0 (the O(n²)/turn bug). The result is
   * byte-identical to the un-cached path — {@link IncrementalFold.syncTo} drives
   * the same `stepFold` over the same events — so it's a pure perf seam.
   *
   * When extensions split the log into 2+ independently-folded slices, the
   * whole-log fold would NOT match (each slice is its own fresh fold), so we
   * fall back to the exact slice path below. Extension cards (error notices /
   * slash-command results) are rare, so the fast path covers the common case.
   */
  fold?: IncrementalFold,
  /** Compact tool metadata from the live session. Desktop/remote clients get
   *  this through `session.info`; passing it here keeps their fold identical
   *  to the TUI's registry-backed fold, including grouped Read/Grep/Glob runs. */
  compactByName?: CompactToolMap,
): RenderNode[] {
  // Fast path: no extension cards → one contiguous fold over all events. Reuse
  // the caller's IncrementalFold so a freshly-committed event re-folds only the
  // open tail. (`syncTo` rebuilds from scratch if the prefix shifted.)
  if (extensions.length === 0 && fold) {
    const out: RenderNode[] = [];
    for (const block of fold.syncTo(events)) out.push({ kind: 'block', block });
    return out;
  }
  const out: RenderNode[] = [];
  const sorted = [...extensions].sort((a, b) => a.afterCount - b.afterCount);
  let cursor = 0;
  const foldSlice = (slice: ReadonlyArray<MoxxyEvent>): void => {
    if (slice.length === 0) return;
    for (const block of pairToolEvents(slice, compactByName)) out.push({ kind: 'block', block });
  };
  for (const ext of sorted) {
    const at = Math.min(Math.max(ext.afterCount, 0), events.length);
    if (at > cursor) {
      foldSlice(events.slice(cursor, at));
      cursor = at;
    }
    out.push({ kind: 'ext', ext });
  }
  foldSlice(events.slice(cursor));
  return out;
}

/** Synthesize an assistant_message event from streamed text (the
 *  turn-end fallback). Only the fields the fold + renderer read are
 *  meaningful; the rest satisfy the branded EventBase shape. */
function synthAssistantMessage(text: string, turnId: string): MoxxyEvent {
  return {
    type: 'assistant_message',
    content: text,
    stopReason: 'end_turn',
    id: newBlockId(),
    seq: -1,
    ts: Date.now(),
    sessionId: '',
    turnId,
    source: 'model',
  } as unknown as MoxxyEvent;
}

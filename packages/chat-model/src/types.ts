import type {
  MoxxyEvent,
  SkillInvokedEvent,
  ToolCallRequestedEvent,
  ToolCompactPresentation,
  ToolResultEvent,
} from '@moxxy/sdk';

export type Block =
  | EventBlock
  | ToolCallBlockData
  | SkillScopeBlock
  | SubagentBlock
  | SubagentGroupBlock
  | LiveToolBlockData;

/**
 * Aggregated view of one spawned subagent. Built from the plugin_event
 * stream the SubagentSpawner emits: `subagent_started` opens it,
 * `subagent_tool_call` increments the tool counter, `subagent_completed`
 * stamps the final state. Rendered as a single dim row by default
 * (`◆ agent <label> · <state> Ns · N tool calls`) so a fleet of 5
 * agents takes 5 rows, not 50.
 */
export interface SubagentBlock {
  kind: 'subagent';
  readonly id: string;
  readonly childSessionId: string;
  readonly label: string;
  /** The kind this child was spawned as (e.g. `Explore`); `default` when unset. */
  agentType: string;
  readonly startedAtMs: number;
  /** ms timestamp of completion, or null while running. */
  completedAtMs: number | null;
  toolCallCount: number;
  /** Total tokens the child consumed (input + output), null until completion. */
  tokensUsed: number | null;
  /** The agent's tool calls in order (name + input), accumulated live from
   *  `subagent_tool_call` events — lets a surface show what it's doing. */
  readonly toolCalls: Array<{ readonly name: string; readonly input: unknown }>;
  /** stop reason for completed agents; populated on subagent_completed. */
  stopReason: string | null;
  /** First line of the agent's final assistant message — used as a one-line preview. */
  finalPreview: string | null;
  /** Error message if the agent failed (subagent_error/abort or non-OK stopReason). */
  error: string | null;
}

/**
 * A run of consecutive sibling subagents (a `dispatch_agent` fan-out) folded
 * into one collapsible group. Rendered as a header (`N Explore agents
 * finished`) over a tree of per-agent rows (`label · N tool uses · NN.Nk
 * tokens` + a status sub-line). A lone agent still folds into a group of one.
 */
export interface SubagentGroupBlock {
  kind: 'subagent-group';
  readonly id: string;
  /** Shared kind across the group, or `'mixed'` when members differ. */
  agentType: string;
  /** Member agents, mutated in place as their events accrete. */
  agents: SubagentBlock[];
}

export interface EventBlock {
  readonly kind: 'event';
  readonly id: string;
  readonly event: MoxxyEvent;
}

export interface ToolCallBlockData {
  kind: 'tool-call';
  readonly id: string;
  readonly request: ToolCallRequestedEvent;
  outcome: ToolResultEvent | { type: 'denied'; reason: string } | null;
}

export interface SkillScopeBlock {
  kind: 'skill-scope';
  readonly id: string;
  readonly skillEvent: SkillInvokedEvent;
  children: Block[];
  /**
   * A scope is "closed" once the turn ends (another user_prompt arrives
   * after it). Closed scopes collapse to a one-line summary by default;
   * in-flight scopes render expanded so the user can watch tools run.
   */
  closed: boolean;
}

/**
 * One tool invocation inside a live-tools aggregate. Same outcome shape
 * as a verbose `ToolCallBlockData` so the result/denied paths can be
 * applied uniformly via callId lookup.
 */
export interface LiveToolCall {
  readonly id: string;
  readonly request: ToolCallRequestedEvent;
  readonly compact: ToolCompactPresentation;
  outcome: ToolResultEvent | { type: 'denied'; reason: string } | null;
}

/**
 * A run of consecutive "compact" tool calls aggregated into one live
 * block. The renderer shows a verb summary ("Reading 3 files, searching
 * for 1 pattern…") plus a one-line preview of the latest call. When the
 * global Ctrl+O toggle is on, the block expands to render every call.
 *
 * A live block is "closed" once anything non-compact happens in the
 * turn (assistant_message, a verbose tool call, a new user_prompt, …).
 * Closed live blocks behave the same visually — they just won't accept
 * more calls.
 */
export interface LiveToolBlockData {
  kind: 'live-tools';
  readonly id: string;
  calls: LiveToolCall[];
  closed: boolean;
}

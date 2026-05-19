import type {
  MoxxyEvent,
  SkillInvokedEvent,
  ToolCallRequestedEvent,
  ToolResultEvent,
} from '@moxxy/sdk';

export type Block = EventBlock | ToolCallBlockData | SkillScopeBlock | SubagentBlock;

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
  readonly startedAtMs: number;
  /** ms timestamp of completion, or null while running. */
  completedAtMs: number | null;
  toolCallCount: number;
  /** stop reason for completed agents; populated on subagent_completed. */
  stopReason: string | null;
  /** First line of the agent's final assistant message — used as a one-line preview. */
  finalPreview: string | null;
  /** Error message if the agent failed (subagent_error/abort or non-OK stopReason). */
  error: string | null;
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

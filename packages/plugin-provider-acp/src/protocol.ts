/**
 * The part of the Agent Client Protocol (ACP, protocol version 1) Moxxy
 * speaks, written by hand from recorded `opencode acp` 1.18.35 sessions.
 * Agents send more than this; anything not listed here is left alone.
 */

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpSelectOption {
  readonly value: string;
  readonly name?: string;
}

/** A session setting the agent offers (`model`, `mode`, `effort`), changed with `session/set_config_option`. */
export interface AcpConfigOption {
  readonly id: string;
  readonly name?: string;
  /** `model`, `mode`, `thought_level`, … */
  readonly category?: string;
  readonly type: string;
  readonly currentValue: string;
  readonly options?: ReadonlyArray<AcpSelectOption>;
}

export interface AcpSessionResponse {
  readonly sessionId?: string;
  readonly configOptions?: ReadonlyArray<AcpConfigOption>;
}

export type AcpStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

export interface AcpUsage {
  /** Prompt tokens not served from the cache. */
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly thoughtTokens?: number;
  readonly cachedReadTokens?: number;
  readonly cachedWriteTokens?: number;
  readonly totalTokens?: number;
}

export interface AcpPromptResponse {
  readonly stopReason: AcpStopReason;
  readonly usage?: AcpUsage;
}

export type AcpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string }
  | {
      readonly type: 'resource';
      readonly resource: { readonly uri: string; readonly mimeType?: string; readonly text?: string; readonly blob?: string };
    };

export type AcpToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';

export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AcpToolCallContent =
  | { readonly type: 'content'; readonly content: { readonly type: string; readonly text?: string } }
  | { readonly type: 'diff'; readonly path: string; readonly oldText?: string | null; readonly newText: string }
  | { readonly type: 'terminal'; readonly terminalId: string };

/** A `tool_call` or `tool_call_update`: each update carries only what changed. */
export interface AcpToolCall {
  readonly toolCallId: string;
  readonly title?: string;
  readonly kind?: AcpToolKind;
  readonly status?: AcpToolStatus;
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
  readonly content?: ReadonlyArray<AcpToolCallContent>;
  readonly locations?: ReadonlyArray<{ readonly path: string }>;
}

export type AcpSessionUpdate =
  | { readonly sessionUpdate: 'agent_message_chunk'; readonly messageId?: string; readonly content: { readonly type: string; readonly text?: string } }
  | { readonly sessionUpdate: 'agent_thought_chunk'; readonly messageId?: string; readonly content: { readonly type: string; readonly text?: string } }
  | ({ readonly sessionUpdate: 'tool_call' } & AcpToolCall)
  | ({ readonly sessionUpdate: 'tool_call_update' } & AcpToolCall)
  | { readonly sessionUpdate: string; readonly [key: string]: unknown };

export type AcpPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface AcpPermissionRequest {
  readonly sessionId: string;
  readonly toolCall: AcpToolCall;
  readonly options: ReadonlyArray<{ readonly optionId: string; readonly kind: AcpPermissionOptionKind; readonly name?: string }>;
}

export type AcpPermissionOutcome =
  | { readonly outcome: { readonly outcome: 'selected'; readonly optionId: string } }
  | { readonly outcome: { readonly outcome: 'cancelled' } };

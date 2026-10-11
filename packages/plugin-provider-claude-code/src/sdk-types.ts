/**
 * The part of the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) Moxxy
 * uses, typed here because the SDK is installed into `~/.moxxy` and loaded at
 * runtime rather than bundled (it needs zod 4; the repo is on zod 3). Shapes
 * follow the SDK's own `sdk.d.ts` (0.3.296); fields Moxxy does not read are left out.
 */

export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudeContentBlockText {
  readonly type: 'text';
  readonly text: string;
}
export interface ClaudeContentBlockThinking {
  readonly type: 'thinking';
  readonly thinking: string;
}
export interface ClaudeContentBlockToolUse {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
export interface ClaudeContentBlockToolResult {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content?: string | ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly is_error?: boolean;
}
export type ClaudeContentBlock =
  | ClaudeContentBlockText
  | ClaudeContentBlockThinking
  | ClaudeContentBlockToolUse
  | ClaudeContentBlockToolResult
  | { readonly type: string };

/** What Moxxy sends: a user message of the Messages API. */
export type ClaudeUserContent =
  | string
  | ReadonlyArray<
      | { readonly type: 'text'; readonly text: string }
      | { readonly type: 'image'; readonly source: { readonly type: 'base64'; readonly media_type: string; readonly data: string } }
      | { readonly type: 'document'; readonly source: { readonly type: 'base64'; readonly media_type: string; readonly data: string } }
    >;

export interface ClaudeUserMessage {
  readonly type: 'user';
  readonly message: { readonly role: 'user'; readonly content: ClaudeUserContent };
  readonly parent_tool_use_id: null;
  readonly origin: { readonly kind: 'human' };
}

export interface ClaudeUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

/** Claude's messages Moxxy reads; others (status, hooks, task notes) arrive too and are passed over. */
export type ClaudeMessage =
  | {
      readonly type: 'system';
      readonly subtype: 'init';
      readonly session_id: string;
      readonly permissionMode?: ClaudePermissionMode;
      readonly model?: string;
    }
  | { readonly type: 'system'; readonly subtype: string; readonly session_id?: string }
  | {
      readonly type: 'assistant';
      readonly message: { readonly model?: string; readonly content: ReadonlyArray<ClaudeContentBlock> };
      readonly parent_tool_use_id: string | null;
      readonly session_id?: string;
    }
  | {
      readonly type: 'user';
      readonly message: { readonly content: string | ReadonlyArray<ClaudeContentBlock> };
      readonly parent_tool_use_id: string | null;
      readonly isSynthetic?: boolean;
    }
  | {
      readonly type: 'stream_event';
      readonly event: {
        readonly type: string;
        readonly delta?: { readonly type: string; readonly text?: string; readonly thinking?: string };
      };
      readonly parent_tool_use_id: string | null;
    }
  | {
      readonly type: 'result';
      readonly subtype: string;
      /** Who started the turn: the person, or Claude itself after a background task. */
      readonly origin?: { readonly kind: string };
      readonly is_error: boolean;
      readonly result?: string;
      readonly session_id: string;
      readonly stop_reason?: string | null;
      readonly terminal_reason?: string | null;
      readonly usage?: ClaudeUsage;
      readonly errors?: ReadonlyArray<string>;
    };

export type ClaudePermissionResult =
  | { readonly behavior: 'allow'; readonly updatedInput?: Record<string, unknown> }
  | { readonly behavior: 'deny'; readonly message: string; readonly interrupt?: boolean };

export type ClaudeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    readonly signal: AbortSignal;
    readonly toolUseID?: string;
    readonly description?: string;
    readonly title?: string;
    readonly mcpServer?: { readonly name: string; readonly source: string };
  },
) => Promise<ClaudePermissionResult>;

export interface ClaudePreToolUseInput {
  readonly hook_event_name: 'PreToolUse';
  readonly tool_name: string;
  readonly tool_input: unknown;
  readonly tool_use_id: string;
}

export interface ClaudePreToolUseOutput {
  readonly hookSpecificOutput?: {
    readonly hookEventName: 'PreToolUse';
    readonly permissionDecision: 'deny';
    readonly permissionDecisionReason: string;
  };
}

export type ClaudeHookCallback = (
  input: ClaudePreToolUseInput,
  toolUseID: string | undefined,
  options: { readonly signal: AbortSignal },
) => Promise<ClaudePreToolUseOutput>;

export interface ClaudeQueryOptions {
  readonly cwd: string;
  readonly model?: string;
  readonly effort?: ClaudeEffort;
  /** The Claude Code preset for agent turns; a plain prompt for one-off text calls. */
  readonly systemPrompt: { readonly type: 'preset'; readonly preset: 'claude_code' } | string;
  readonly pathToClaudeCodeExecutable?: string;
  /** Left out to keep the mode the person set up in Claude's own settings. */
  readonly permissionMode?: ClaudePermissionMode;
  readonly allowDangerouslySkipPermissions?: boolean;
  readonly maxTurns?: number;
  readonly includePartialMessages?: boolean;
  readonly resume?: string;
  readonly persistSession?: boolean;
  readonly tools?: ReadonlyArray<string>;
  readonly settingSources?: ReadonlyArray<'user' | 'project' | 'local'>;
  readonly mcpServers?: Record<string, { readonly type: 'http'; readonly url: string; readonly headers: Record<string, string> }>;
  readonly canUseTool?: ClaudeCanUseTool;
  readonly hooks?: { readonly PreToolUse?: ReadonlyArray<{ readonly hooks: ReadonlyArray<ClaudeHookCallback> }> };
  readonly env?: Record<string, string | undefined>;
  readonly stderr?: (data: string) => void;
}

export interface ClaudeQuery extends AsyncIterable<ClaudeMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: ClaudePermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  close(): void;
}

export interface ClaudeAgentSdk {
  query(params: { prompt: string | AsyncIterable<ClaudeUserMessage>; options: ClaudeQueryOptions }): ClaudeQuery;
  /** One of Claude's saved sessions, searched across every project; `undefined` when it no longer exists. */
  getSessionInfo?(sessionId: string): Promise<{ readonly sessionId: string } | undefined>;
}

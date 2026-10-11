/**
 * The part of the `codex app-server` protocol Moxxy speaks, written by hand
 * from `codex app-server generate-ts` (0.155.1). Codex sends far more than
 * this; anything not listed here is read as unknown and left alone.
 */

export type CodexApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'never'
  | { readonly granular: Readonly<Record<string, boolean>> };

export type CodexSandboxPolicy =
  | { readonly type: 'dangerFullAccess' }
  | { readonly type: 'readOnly'; readonly networkAccess?: boolean }
  | { readonly type: 'workspaceWrite'; readonly [key: string]: unknown }
  | { readonly type: 'externalSandbox'; readonly [key: string]: unknown };

/** What `thread/start` and `thread/resume` answer: the thread as Codex really runs it. */
export interface CodexThreadResponse {
  readonly thread: { readonly id: string };
  readonly model: string;
  readonly approvalPolicy: CodexApprovalPolicy;
  readonly sandbox: CodexSandboxPolicy;
  readonly approvalsReviewer?: CodexApprovalsReviewer;
  readonly reasoningEffort: string | null;
  readonly serviceTier?: string | null;
}

/** Who answers Codex's approvals: the person, or Codex's own reviewer. */
export type CodexApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent';

/** What `config/read` answers: the person's effective Codex config, as far as Moxxy reads it. */
export interface CodexConfigRead {
  readonly config: { readonly model_reasoning_summary?: string | null };
}

export type CodexUserInput =
  | { readonly type: 'text'; readonly text: string; readonly text_elements: ReadonlyArray<never> }
  | { readonly type: 'image'; readonly url: string }
  | { readonly type: 'localImage'; readonly path: string };

export type CodexCollaborationMode = {
  readonly mode: 'plan' | 'default';
  readonly settings: { readonly model: string; readonly reasoning_effort: string | null; readonly developer_instructions: null };
};

/** Fields of `thread/settings/update`; each applies to the thread's later turns. */
export interface CodexThreadSettings {
  readonly approvalPolicy?: CodexApprovalPolicy;
  readonly sandboxPolicy?: CodexSandboxPolicy;
  readonly model?: string;
  readonly effort?: string;
  readonly collaborationMode?: CodexCollaborationMode;
}

export type CodexTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface CodexTurn {
  readonly id: string;
  readonly status: CodexTurnStatus;
  readonly error?: { readonly message: string } | null;
}

export type CodexGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';

export interface CodexGoal {
  readonly objective: string;
  readonly status: CodexGoalStatus;
}

/** A question Codex's plan mode asks inside its message (`delivery: 'async'`). */
export interface CodexAsyncQuestion {
  readonly title: string;
  readonly options: ReadonlyArray<string> | null;
}

export type CodexItem =
  | {
      readonly type: 'agentMessage';
      readonly id: string;
      readonly text: string;
      readonly phase?: string | null;
      readonly delivery?: 'async' | null;
      readonly questions?: ReadonlyArray<CodexAsyncQuestion> | null;
    }
  | { readonly type: 'plan'; readonly id: string; readonly text: string }
  | { readonly type: 'reasoning'; readonly id: string; readonly summary: ReadonlyArray<string>; readonly content: ReadonlyArray<string> }
  | {
      readonly type: 'commandExecution';
      readonly id: string;
      readonly command: string;
      readonly cwd: string;
      readonly status: string;
      readonly aggregatedOutput: string | null;
      readonly exitCode: number | null;
      readonly commandActions?: ReadonlyArray<{ readonly command?: string }>;
    }
  | {
      readonly type: 'fileChange';
      readonly id: string;
      readonly status: string;
      readonly changes: ReadonlyArray<{ readonly path: string; readonly kind: { readonly type: string }; readonly diff?: string }>;
    }
  | {
      readonly type: 'mcpToolCall';
      readonly id: string;
      readonly server: string;
      readonly tool: string;
      readonly status: string;
      readonly arguments: unknown;
      readonly result: unknown;
      readonly error: { readonly message: string } | null;
    }
  | { readonly type: 'webSearch'; readonly id: string; readonly query: string; readonly action?: CodexWebSearchAction | null }
  | { readonly type: 'imageView'; readonly id: string; readonly path: string };

export type CodexWebSearchAction =
  | { readonly type: 'search'; readonly query?: string; readonly queries?: ReadonlyArray<string> }
  | { readonly type: 'open_page'; readonly url?: string }
  | { readonly type: 'find_in_page'; readonly url?: string; readonly pattern?: string }
  | { readonly type: 'other' };

const KNOWN_ITEMS = new Set<string>(['agentMessage', 'plan', 'reasoning', 'commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'imageView']);

/** An item Moxxy reads, or `undefined` for the many kinds it leaves alone. */
export function knownItem(value: unknown): CodexItem | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { type, id } = value as { type?: unknown; id?: unknown };
  return typeof type === 'string' && typeof id === 'string' && KNOWN_ITEMS.has(type) ? (value as CodexItem) : undefined;
}

export interface CodexTokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

/** `item/tool/requestUserInput` (experimental): a blocking question with ids. */
export interface CodexUserInputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly isOther: boolean;
  readonly isSecret: boolean;
  readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }> | null;
}

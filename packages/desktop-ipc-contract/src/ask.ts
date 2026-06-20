import type { ApprovalRequest, PermissionMode } from '@moxxy/sdk';

/**
 * Window/event-bus key a thin client listens for to re-fetch `session.info`
 * after switching the active mode out-of-band (e.g. the desktop composer's Goal
 * button). Lives in the contract — not a UI module — so the shared
 * `useActiveModeBadge` hook can import the constant without reaching into any
 * platform's component tree. Platforms route it through their `EventBus`
 * capability (the desktop's wraps `window` events).
 */
export const SESSION_INFO_REFRESH_EVENT = 'moxxy:session-info-refresh';

// ---------- Interactive ask (permission / approval prompts) ---------------

/**
 * A decision the runner needs from the user, forwarded from the connected
 * session to the renderer. `kind: 'permission'` gates a tool call;
 * `kind: 'approval'` is a loop-strategy confirmation (research, …);
 * `kind: 'workflow'` is a workflow awaitInput pause. The renderer renders a
 * bottom sheet and replies with {@link AskResponse} keyed by `requestId`.
 */
export interface WorkflowAsk {
  readonly runId: string;
  readonly workflow: string;
  readonly stepId: string;
  readonly label: string;
  readonly prompt: string;
}

export interface AskRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly kind: 'permission' | 'approval' | 'workflow';
  /** Present for `kind: 'permission'`. */
  readonly tool?: { readonly name: string; readonly input: unknown; readonly description?: string };
  /** Present for `kind: 'approval'`. */
  readonly approval?: ApprovalRequest;
  /** Present for `kind: 'workflow'`. */
  readonly workflow?: WorkflowAsk;
}

export interface AskResponse {
  /** Permission verdict (kind: 'permission'). */
  readonly mode?: PermissionMode;
  /** Chosen approval option id (kind: 'approval'). */
  readonly optionId?: string;
  /** Free-text follow-up when the chosen approval option requested it, or the workflow reply. */
  readonly text?: string;
}

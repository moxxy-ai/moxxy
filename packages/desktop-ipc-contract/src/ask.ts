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
 * `kind: 'approval'` is a loop-strategy confirmation (research, …).
 * The renderer renders a bottom sheet and replies with {@link AskResponse}
 * keyed by `requestId`.
 */
export interface AskRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly kind: 'permission' | 'approval';
  /** Present for `kind: 'permission'`. */
  readonly tool?: { readonly name: string; readonly input: unknown; readonly description?: string };
  /** Present for `kind: 'approval'`. */
  readonly approval?: ApprovalRequest;
}

export interface AskResponse {
  /** Permission verdict (kind: 'permission'). */
  readonly mode?: PermissionMode;
  /** Chosen approval option id (kind: 'approval'). */
  readonly optionId?: string;
  /** Free-text follow-up when the chosen approval option requested it. */
  readonly text?: string;
}

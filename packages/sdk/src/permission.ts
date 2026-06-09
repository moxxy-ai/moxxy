import type { ToolCallRequestedEvent } from './events.js';

export type PermissionMode = 'allow' | 'allow_session' | 'allow_always' | 'deny';

export interface PermissionDecision {
  readonly mode: PermissionMode;
  readonly reason?: string;
}

export interface PermissionRule {
  readonly action: 'allow' | 'deny' | 'prompt';
  readonly pattern?: { name?: string | RegExp; inputMatches?: Record<string, string | RegExp> };
  readonly reason?: string;
}

export interface PendingToolCall {
  readonly callId: ToolCallRequestedEvent['callId'];
  readonly name: string;
  readonly input: unknown;
  /**
   * Sequence number of the `tool_call_requested` event in the EventLog.
   * Optional because permission resolvers may construct PendingToolCalls
   * for evaluations that aren't yet on the log (e.g., hook rewrites).
   */
  readonly requestedAtSeq?: number;
}

export interface PermissionContext {
  readonly toolDescription?: string;
  readonly skillContext?: string;
  readonly sessionId: string;
}

export interface PermissionResolver {
  readonly name: string;
  check(call: PendingToolCall, ctx: PermissionContext): Promise<PermissionDecision>;
  /**
   * Optional prompt-free policy probe. Returns the decision the persistent
   * policy layer would make for this call (user deny/allow rules from
   * `~/.moxxy/permissions.json`, then the tool's own declared rule), or
   * `null` when no rule matches — WITHOUT falling through to the
   * interactive prompt path that `check` takes.
   *
   * Core's session resolver (the policy wrapper) implements this; bare
   * resolvers may omit it. Auto-approving modes (e.g. goal mode) consult it
   * before allowing, so a configured deny rule still denies in unattended
   * runs while nothing can ever block on a prompt.
   */
  policyCheck?(call: PendingToolCall, ctx: PermissionContext): Promise<PermissionDecision | null>;
}

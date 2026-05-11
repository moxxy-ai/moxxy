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
}

export interface PermissionContext {
  readonly toolDescription?: string;
  readonly skillContext?: string;
  readonly sessionId: string;
}

export interface PermissionResolver {
  readonly name: string;
  check(call: PendingToolCall, ctx: PermissionContext): Promise<PermissionDecision>;
}

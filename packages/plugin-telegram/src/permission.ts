import type { PendingToolCall, PermissionContext, PermissionDecision, PermissionResolver } from '@moxxy/sdk';

export interface PendingPermission {
  readonly callId: string;
  readonly call: PendingToolCall;
  readonly ctx: PermissionContext;
  readonly resolve: (decision: PermissionDecision) => void;
}

/**
 * Permission resolver that defers each tool call to an external decider (the
 * Telegram bot, which renders an inline keyboard and waits for a callback).
 * The Telegram channel registers a callback handler that invokes
 * `resolvePending(callId, decision)` when the user clicks a button.
 */
export class TelegramPermissionResolver implements PermissionResolver {
  readonly name = 'telegram';
  private readonly pending = new Map<string, PendingPermission>();
  private readonly sessionAllows = new Set<string>();
  private deciderFn:
    | ((call: PendingToolCall, ctx: PermissionContext) => Promise<void>)
    | null = null;

  setDecider(fn: (call: PendingToolCall, ctx: PermissionContext) => Promise<void>): void {
    this.deciderFn = fn;
  }

  async check(call: PendingToolCall, ctx: PermissionContext): Promise<PermissionDecision> {
    if (this.sessionAllows.has(call.name)) {
      return { mode: 'allow_session', reason: 'allow_session previously granted' };
    }
    if (!this.deciderFn) {
      return { mode: 'deny', reason: 'no decider attached (bot not running)' };
    }
    const decider = this.deciderFn;
    const decision = await new Promise<PermissionDecision>((resolve) => {
      this.pending.set(call.callId, { callId: call.callId, call, ctx, resolve });
      decider(call, ctx).catch((err) => {
        this.pending.delete(call.callId);
        resolve({ mode: 'deny', reason: err instanceof Error ? err.message : String(err) });
      });
    });
    if (decision.mode === 'allow_session') this.sessionAllows.add(call.name);
    return decision;
  }

  /** Called by the bot when a permission callback button is clicked. */
  resolvePending(callId: string, decision: PermissionDecision): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false;
    this.pending.delete(callId);
    pending.resolve(decision);
    return true;
  }

  abortAll(reason = 'channel closed'): void {
    for (const pending of this.pending.values()) {
      pending.resolve({ mode: 'deny', reason });
    }
    this.pending.clear();
  }
}

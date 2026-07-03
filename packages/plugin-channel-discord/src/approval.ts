import type { ApprovalDecision, ApprovalRequest, ApprovalResolver } from '@moxxy/sdk';

export interface PendingApproval {
  readonly id: string;
  readonly request: ApprovalRequest;
  readonly resolve: (decision: ApprovalDecision) => void;
}

/**
 * Generic approval resolver for the Discord channel — counterpart to the TUI's
 * ApprovalDialog. The channel renders the request as a message with a button
 * per option and routes the user's click (or follow-up text, for options with
 * `requestsText: true`) back here via `resolvePending` /
 * `resolvePendingWithText`. Mirrors the Telegram approval resolver's shape.
 */
export class DiscordApprovalResolver implements ApprovalResolver {
  readonly name = 'discord-approval';
  private readonly pending = new Map<string, PendingApproval>();
  private deciderFn: ((id: string, request: ApprovalRequest) => Promise<void>) | null = null;
  private nextId = 1;

  setDecider(fn: (id: string, request: ApprovalRequest) => Promise<void>): void {
    this.deciderFn = fn;
  }

  async confirm(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.deciderFn) {
      // No bot wired up — best fallback is the request's defaultOptionId.
      return { optionId: request.defaultOptionId ?? request.options[0]?.id ?? 'approve' };
    }
    const id = `appr_${this.nextId++}`;
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(id, { id, request, resolve });
      this.deciderFn!(id, request).catch((err) => {
        this.pending.delete(id);
        resolve({
          optionId: request.defaultOptionId ?? request.options[0]?.id ?? 'cancel',
          text: `decider failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    });
  }

  /** Look up a pending approval without resolving it (text follow-up latch). */
  getPending(id: string): PendingApproval | undefined {
    return this.pending.get(id);
  }

  /** Resolve directly with an option id (no text). */
  resolvePending(id: string, optionId: string): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    pending.resolve({ optionId });
    return true;
  }

  /** Resolve with an option id AND a free-text follow-up. */
  resolvePendingWithText(id: string, optionId: string, text: string): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    pending.resolve({ optionId, text });
    return true;
  }

  abortAll(reason = 'channel closed'): void {
    for (const pending of this.pending.values()) {
      pending.resolve({
        optionId: pending.request.defaultOptionId ?? pending.request.options[0]?.id ?? 'cancel',
        text: reason,
      });
    }
    this.pending.clear();
  }
}

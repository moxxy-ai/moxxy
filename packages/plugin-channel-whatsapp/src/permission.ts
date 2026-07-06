import {
  assertDefined,
  createDeferredPermissionResolver,
  type DeferredPermissionResolver,
  type PendingToolCall,
  type PermissionDecision,
} from '@moxxy/sdk';

/**
 * Human-in-the-loop permissions over plain WhatsApp messages. Baileys has no
 * reliable interactive buttons on multi-device, so the prompt is text: the
 * channel sends a numbered question into the owner's chat and interprets the
 * owner's NEXT short reply (`1`/`yes` allow once, `2`/`always` allow for the
 * session, `3`/`no` deny) — the same capture-next-message mechanism Telegram
 * uses for approval follow-up text.
 *
 * Built ON `createDeferredPermissionResolver` (never re-implement the pending
 * tracking — the audit caught a TUI hang from exactly that): the sdk scaffold
 * owns session-allows + abort-on-stop; this wrapper only owns the reply
 * queue + parsing.
 */
export interface WhatsAppPermissionController {
  readonly resolver: DeferredPermissionResolver;
  /** Wire the outbound sender once the socket is up (null on teardown). */
  setSender(send: ((text: string) => Promise<void>) | null): void;
  /** True while a prompt is awaiting the owner's reply. */
  hasPending(): boolean;
  /** Offer an owner message as a reply; true when it resolved a prompt. */
  offerReply(text: string): boolean;
  /** Deny every in-flight prompt (channel stop / session reset). */
  abortAll(reason?: string): void;
}

interface PendingPrompt {
  readonly resolve: (decision: PermissionDecision) => void;
}

export function parsePermissionReply(text: string): PermissionDecision | null {
  const v = text.trim().toLowerCase();
  if (v === '1' || v === 'yes' || v === 'y' || v === 'allow') {
    return { mode: 'allow', reason: 'owner approved via WhatsApp' };
  }
  if (v === '2' || v === 'always') {
    return { mode: 'allow_session', reason: 'owner approved for session via WhatsApp' };
  }
  if (v === '3' || v === 'no' || v === 'n' || v === 'deny') {
    return { mode: 'deny', reason: 'owner denied via WhatsApp' };
  }
  return null;
}

export function formatPermissionPrompt(call: PendingToolCall): string {
  let input = '';
  try {
    input = JSON.stringify(call.input ?? {});
  } catch {
    input = '(unserializable input)';
  }
  if (input.length > 400) input = `${input.slice(0, 400)}…`;
  return (
    `Permission needed: tool *${call.name}*\n` +
    `${input}\n\n` +
    'Reply: 1 = allow once, 2 = allow for session, 3 = deny'
  );
}

export function createWhatsAppPermissionController(): WhatsAppPermissionController {
  // FIFO of prompts awaiting a reply. Tool calls within a turn are sequential,
  // so this is ~1 deep; the queue is defensive against overlap.
  const pending: PendingPrompt[] = [];
  let sender: ((text: string) => Promise<void>) | null = null;

  const resolver = createDeferredPermissionResolver({
    name: 'whatsapp',
    prompt: (call) =>
      new Promise<PermissionDecision>((resolve, reject) => {
        if (!sender) {
          resolve({ mode: 'deny', reason: 'whatsapp channel not connected' });
          return;
        }
        pending.push({ resolve });
        sender(formatPermissionPrompt(call)).catch((err: unknown) => {
          const idx = pending.findIndex((p) => p.resolve === resolve);
          if (idx >= 0) pending.splice(idx, 1);
          reject(err instanceof Error ? err : new Error(String(err)));
        });
      }),
  });

  return {
    resolver,
    setSender(send) {
      sender = send;
    },
    hasPending() {
      return pending.length > 0;
    },
    offerReply(text) {
      if (pending.length === 0) return false;
      const decision = parsePermissionReply(text);
      if (!decision) return false;
      const prompt = pending.shift();
      assertDefined(prompt, 'pending is non-empty past the length guard above');
      prompt.resolve(decision);
      return true;
    },
    abortAll(reason = 'channel closed') {
      // Resolve OUR pending prompt promises (deny) so the sdk scaffold's outer
      // promises settle, then clear the scaffold's own in-flight set too.
      for (const prompt of pending.splice(0)) {
        prompt.resolve({ mode: 'deny', reason });
      }
      resolver.abortAll(reason);
    },
  };
}

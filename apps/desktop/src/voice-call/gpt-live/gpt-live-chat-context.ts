import type { MoxxyEvent } from '@moxxy/sdk';

/** A single chat message forwarded into a running call stays short: GPT-Live
 *  context appends are small, and the model only needs the gist to talk about it. */
export const GPT_LIVE_CHAT_CONTEXT_MAX_CHARS = 2_000;

/**
 * Describe a chat message that appeared while a GPT-Live call is open (typed by
 * the user or answered by the agent), so the voice model stays current with the
 * conversation. Exchanges the call recorded itself are skipped.
 */
export function chatEventToGptLiveContext(
  event: MoxxyEvent,
  ownTurnIds: ReadonlySet<string>,
): string | null {
  if (ownTurnIds.has(event.turnId)) return null;
  if (event.type === 'user_prompt' && event.origin?.kind !== 'checkpoint') {
    return summarize('The user wrote in the Moxxy chat: ', event.text);
  }
  if (event.type === 'assistant_message') {
    return summarize('The Moxxy agent replied in the chat: ', event.content);
  }
  return null;
}

function summarize(prefix: string, raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const full = `${prefix}${text}`;
  return full.length <= GPT_LIVE_CHAT_CONTEXT_MAX_CHARS
    ? full
    : `${full.slice(0, GPT_LIVE_CHAT_CONTEXT_MAX_CHARS - 1)}…`;
}

/**
 * Tracks which chat events a running call should hear about. An exchange the
 * call records comes back through the runner broadcast — possibly before the
 * record request even resolves — so it is recognised by its text and turn, not
 * by a reply that may arrive later.
 */
export class GptLiveChatMirror {
  private readonly pending: string[] = [];
  private readonly ownTurnIds = new Set<string>();
  private readonly seenEventIds = new Set<string>();

  expectRecorded(exchange: { readonly userText?: string; readonly assistantText?: string }): void {
    if (exchange.userText) this.pending.push(`user_prompt:${exchange.userText.trim()}`);
    if (exchange.assistantText) this.pending.push(`assistant_message:${exchange.assistantText.trim()}`);
  }

  contextFor(event: MoxxyEvent): string | null {
    if (this.seenEventIds.has(event.id)) return null;
    this.seenEventIds.add(event.id);
    const key = recordKey(event);
    const index = key === null ? -1 : this.pending.indexOf(key);
    if (index >= 0) {
      this.pending.splice(index, 1);
      this.ownTurnIds.add(event.turnId);
      return null;
    }
    return chatEventToGptLiveContext(event, this.ownTurnIds);
  }
}

function recordKey(event: MoxxyEvent): string | null {
  if (event.type === 'user_prompt') return `user_prompt:${event.text.trim()}`;
  if (event.type === 'assistant_message') return `assistant_message:${event.content.trim()}`;
  return null;
}

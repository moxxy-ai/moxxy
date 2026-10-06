import type { MoxxyEvent } from '@moxxy/sdk';

/** GPT-Live accepts at most 128 initial items totalling 8,192 tokens. */
export const GPT_LIVE_HISTORY_MAX_ITEMS = 128;
export const GPT_LIVE_HISTORY_MAX_TOKENS = 8_192;
/** One message may use at most ~2,048 tokens (a quarter of the budget), so a
 *  single long reply cannot crowd every other message out of the model's view. */
export const GPT_LIVE_HISTORY_MAX_ITEM_CHARS = 8_192;

export interface GptLiveHistoryItem {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/**
 * Project a moxxy session log onto the conversation GPT-Live sees when a voice
 * call starts: the user prompts and assistant replies, newest kept first until
 * the item or token budget is spent, returned oldest-first.
 */
export function buildGptLiveHistory(
  events: ReadonlyArray<MoxxyEvent>,
): GptLiveHistoryItem[] {
  const newestFirst: GptLiveHistoryItem[] = [];
  let tokens = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (newestFirst.length >= GPT_LIVE_HISTORY_MAX_ITEMS) break;
    const item = toHistoryItem(events[index]);
    if (!item) continue;
    const cost = approximateTokens(item.text);
    if (tokens + cost > GPT_LIVE_HISTORY_MAX_TOKENS) break;
    tokens += cost;
    newestFirst.push(item);
  }
  return newestFirst.reverse();
}

function toHistoryItem(event: MoxxyEvent | undefined): GptLiveHistoryItem | null {
  if (event?.type === 'user_prompt' && event.origin?.kind !== 'checkpoint') {
    return fromText('user', event.text);
  }
  if (event?.type === 'assistant_message') return fromText('assistant', event.content);
  return null;
}

function fromText(role: GptLiveHistoryItem['role'], raw: string): GptLiveHistoryItem | null {
  const text = raw.trim();
  if (!text) return null;
  return { role, text: truncate(text) };
}

function truncate(text: string): string {
  if (text.length <= GPT_LIVE_HISTORY_MAX_ITEM_CHARS) return text;
  return `${text.slice(0, GPT_LIVE_HISTORY_MAX_ITEM_CHARS - 1)}…`;
}

/** Same rough four-characters-per-token estimate the Codex client budgets with. */
function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

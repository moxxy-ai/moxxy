import { z } from 'zod/v3';

/**
 * The GPT-Live data-channel protocol (`oai-events`) of OpenAI's Live API,
 * reduced to what Voice Mode reads and sends; see docs/voice-gpt-live.md.
 *
 * The service streams transcript fragments with no turn boundaries, so
 * {@link GptLiveEventReader} folds them into the turns the call logic works
 * with: a turn ends when the other side speaks, a delegation arrives, the
 * session closes, or (for the model) it has gone quiet — see `settle()`.
 */
export type GptLiveRole = 'user' | 'assistant';

export type GptLiveEvent =
  | { readonly type: 'session-started' }
  | { readonly type: 'turn-started'; readonly role: GptLiveRole }
  | {
      readonly type: 'turn-done';
      readonly role: GptLiveRole;
      readonly turnId: string;
      readonly text: string;
    }
  | {
      readonly type: 'delegation';
      readonly itemId: string;
      /** The user turn GPT-Live delegated; its transcript is the agent prompt. */
      readonly userTurnId: string | null;
    }
  | { readonly type: 'session-closed'; readonly reason: string }
  | { readonly type: 'error'; readonly message: string };

export interface GptLiveThinkingAppend {
  readonly type: 'session.thinking.append';
  readonly delegation_id: null;
  readonly content: string;
}

export interface GptLiveCommentaryAppend {
  readonly type: 'session.commentary.append';
  readonly delegation_id: string;
  readonly content: string;
}

export const GPT_LIVE_SESSION_CLOSE = Object.freeze({ type: 'session.close' });

const MAX_EVENT_CHARS = 256_000;
const MAX_CONTEXT_APPEND_BYTES = 500;

const text = z.string().max(100_000);
const transcriptDelta = z.object({
  type: z.enum(['session.input_transcript.delta', 'session.output_transcript.delta']),
  delta: text,
});
const delegationCreated = z.object({
  type: z.literal('session.delegation.created'),
  delegation: z.object({
    id: z.string().min(1).max(256),
    type: z.literal('delegation'),
    target: z.literal('client'),
  }),
});
const sessionStarted = z.object({ type: z.literal('session.started') });
const sessionClosed = z.object({ type: z.literal('session.closed'), reason: z.string().max(256) });
const protocolError = z.object({
  type: z.literal('error'),
  error: z.object({ message: z.string().min(1).max(2_048) }),
});

interface OpenTurn {
  readonly role: GptLiveRole;
  readonly turnId: string;
  text: string;
}

/** Folds the Live API's server frames into Voice Mode's turn events. One per call. */
export class GptLiveEventReader {
  private open: OpenTurn | null = null;
  private lastUserTurnId: string | null = null;
  private readonly counts: Record<GptLiveRole, number> = { user: 0, assistant: 0 };

  /** The model is mid-turn; its turn ends on `settle()` once it goes quiet. */
  get speaking(): boolean {
    return this.open?.role === 'assistant';
  }

  read(raw: string): GptLiveEvent[] {
    if (raw.length > MAX_EVENT_CHARS) return [];
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }

    const delta = transcriptDelta.safeParse(value);
    if (delta.success) {
      const role: GptLiveRole = delta.data.type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      return this.append(role, delta.data.delta);
    }
    const delegation = delegationCreated.safeParse(value);
    if (delegation.success) {
      return [...this.finish(), { type: 'delegation', itemId: delegation.data.delegation.id, userTurnId: this.lastUserTurnId }];
    }
    if (sessionStarted.safeParse(value).success) return [{ type: 'session-started' }];
    const closed = sessionClosed.safeParse(value);
    if (closed.success) return [...this.finish(), { type: 'session-closed', reason: closed.data.reason }];
    const error = protocolError.safeParse(value);
    if (error.success) return [{ type: 'error', message: error.data.error.message }];
    return [];
  }

  /** The model has stopped speaking: end its turn. */
  settle(): GptLiveEvent[] {
    return this.speaking ? this.finish() : [];
  }

  /** The call ends on this side: end whichever turn is still open. */
  end(): GptLiveEvent[] {
    return this.finish();
  }

  private append(role: GptLiveRole, fragment: string): GptLiveEvent[] {
    const events: GptLiveEvent[] = [];
    if (this.open && this.open.role !== role) events.push(...this.finish());
    if (!this.open) {
      this.counts[role] += 1;
      this.open = { role, turnId: `${role}_${this.counts[role]}`, text: '' };
      if (role === 'user') this.lastUserTurnId = this.open.turnId;
      events.push({ type: 'turn-started', role });
    }
    this.open.text += fragment;
    return events;
  }

  private finish(): GptLiveEvent[] {
    const turn = this.open;
    this.open = null;
    if (!turn) return [];
    return [{ type: 'turn-done', role: turn.role, turnId: turn.turnId, text: turn.text.trim() }];
  }
}

/** Silent context: `session.thinking.append` informs the model without making it speak. */
export function buildGptLiveDeveloperContext(value: string): GptLiveThinkingAppend[] {
  return chunkUtf8(value, MAX_CONTEXT_APPEND_BYTES).map((chunk) => ({
    type: 'session.thinking.append',
    delegation_id: null,
    content: chunk,
  }));
}

/** The delegation's result, which GPT-Live then tells the user. */
export function buildGptLiveDelegationResult(itemId: string, value: string): GptLiveCommentaryAppend[] {
  return chunkUtf8(value, MAX_CONTEXT_APPEND_BYTES).map((chunk) => ({
    type: 'session.commentary.append',
    delegation_id: itemId,
    content: chunk,
  }));
}

function chunkUtf8(value: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (chunk && chunkBytes + characterBytes > maxBytes) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

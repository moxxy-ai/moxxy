import { z } from 'zod';

/**
 * The GPT-Live data-channel protocol (`oai-events`), reduced to what Voice Mode
 * reads and sends. Shapes are the ones the live service emits; see
 * docs/voice-gpt-live.md for the captured contract.
 */
export type GptLiveRole = 'user' | 'assistant';

export type GptLiveEvent =
  | { readonly type: 'session-started' }
  | { readonly type: 'transcript'; readonly role: GptLiveRole; readonly text: string }
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

export interface GptLiveContextAppend {
  readonly type: 'session.context.append';
  readonly channel: 'developer';
  readonly content: readonly [{ readonly type: 'input_text'; readonly text: string }];
}

export interface GptLiveDelegationAppend {
  readonly type: 'delegation.context.append';
  readonly delegation_item_id: string;
  readonly channel: 'speakable';
  readonly content: readonly [{ readonly type: 'input_text'; readonly text: string }];
}

export const GPT_LIVE_SESSION_CLOSE = Object.freeze({ type: 'session.close' });

const MAX_EVENT_CHARS = 256_000;
const MAX_CONTEXT_APPEND_BYTES = 500;

const id = z.string().min(1).max(256);
const text = z.string().max(100_000);
const role = z.enum(['user', 'assistant']);
const transcriptAdded = z.object({
  type: z.enum(['input_transcript.added', 'output_transcript.added']),
  item: z.object({ text }),
});
const turn = z.object({ id, role, transcript: text });
const turnCreated = z.object({ type: z.literal('turn.created'), turn: turn.pick({ role: true }) });
const turnDone = z.object({ type: z.literal('turn.done'), turn });
const delegationCreated = z.object({
  type: z.literal('delegation.created'),
  item: z.object({
    id,
    type: z.literal('delegation'),
    target: z.literal('client'),
    user_bidi_turn_id: id.optional(),
  }),
});
const sessionStarted = z.object({ type: z.literal('session.started') });
const sessionClosed = z.object({ type: z.literal('session.closed'), reason: z.string().max(256) });
const protocolError = z.object({
  type: z.literal('error'),
  error: z.object({ message: z.string().min(1).max(2_048) }),
});

export function parseGptLiveEvent(raw: string): GptLiveEvent | null {
  if (raw.length > MAX_EVENT_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  const added = transcriptAdded.safeParse(value);
  if (added.success) {
    return {
      type: 'transcript',
      role: added.data.type === 'input_transcript.added' ? 'user' : 'assistant',
      text: added.data.item.text,
    };
  }
  const created = turnCreated.safeParse(value);
  if (created.success) return { type: 'turn-started', role: created.data.turn.role };
  const done = turnDone.safeParse(value);
  if (done.success) {
    return {
      type: 'turn-done',
      role: done.data.turn.role,
      turnId: done.data.turn.id,
      text: done.data.turn.transcript.trim(),
    };
  }
  const delegation = delegationCreated.safeParse(value);
  if (delegation.success) {
    return {
      type: 'delegation',
      itemId: delegation.data.item.id,
      userTurnId: delegation.data.item.user_bidi_turn_id ?? null,
    };
  }
  if (sessionStarted.safeParse(value).success) return { type: 'session-started' };
  const closed = sessionClosed.safeParse(value);
  if (closed.success) return { type: 'session-closed', reason: closed.data.reason };
  const error = protocolError.safeParse(value);
  if (error.success) return { type: 'error', message: error.data.error.message };
  return null;
}

/** Silent context: the `developer` channel informs the model without making it speak. */
export function buildGptLiveDeveloperContext(value: string): GptLiveContextAppend[] {
  return chunkUtf8(value, MAX_CONTEXT_APPEND_BYTES).map((chunk) => ({
    type: 'session.context.append',
    channel: 'developer',
    content: [{ type: 'input_text', text: chunk }],
  }));
}

/** The delegation's result, which GPT-Live then tells the user (speakable). */
export function buildGptLiveDelegationResult(itemId: string, value: string): GptLiveDelegationAppend[] {
  return chunkUtf8(value, MAX_CONTEXT_APPEND_BYTES).map((chunk) => ({
    type: 'delegation.context.append',
    delegation_item_id: itemId,
    channel: 'speakable',
    content: [{ type: 'input_text', text: chunk }],
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

import type { newTurnId } from '@moxxy/core';
import { FramePump, PlainTurnRenderer, driveTurn, subscribeTurn } from '@moxxy/channel-kit';
import { assertDefined, type ClientSession as Session } from '@moxxy/sdk';
import type { WaMessageKey, WhatsAppSocket } from '../socket.js';

/**
 * Streaming strategy (justified against the Baileys API):
 *
 * WhatsApp supports true message edits (a MESSAGE_EDIT protocol send —
 * `sendMessage(jid, { text, edit: key })`, stable in Baileys since 6.5), so the
 * channel streams the way Telegram/Slack do: send ONE message on the first
 * frame, then edit it in place — the user watches a single message grow instead
 * of a flood of partials that can't be assembled. Two WhatsApp-specific
 * adjustments:
 *
 *  - `editFrameMs` defaults to 3000 (vs 1000 elsewhere): every edit is a full
 *    outbound protocol message, and high-frequency automated edits are exactly
 *    the anomalous traffic that gets numbers flagged on an UNOFFICIAL client.
 *    Fewer, chunkier edits keep the visible behavior close to a human editing
 *    a message. (WhatsApp's ~15-minute edit window is irrelevant at turn scale.)
 *
 *  - overflow splitting happens ONLY on the final frame: while streaming, the
 *    frame is truncated to {@link WHATSAPP_MAX_MESSAGE_CHARS}; the final flush
 *    edits the streamed message to the first chunk and sends the tail chunks as
 *    follow-up messages (mirrors Telegram's split-tails). If a FINAL edit fails
 *    (edit rejected / message gone), the sink falls back to sending the chunks
 *    as new messages so the reply is never silently lost.
 */
export const WHATSAPP_MAX_MESSAGE_CHARS = 4000;
export const DEFAULT_EDIT_FRAME_MS = 3000;

/** Split text into ≤maxLen chunks, preferring newline then space boundaries. */
export function splitWhatsAppText(
  text: string,
  maxLen: number = WHATSAPP_MAX_MESSAGE_CHARS,
): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = window.lastIndexOf('\n');
    if (cut < maxLen * 0.5) cut = window.lastIndexOf(' ');
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, '');
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

export interface TurnRunnerLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface RunWhatsAppTurnDeps {
  readonly session: Session;
  readonly socket: WhatsAppSocket;
  readonly editFrameMs: number;
  /** Record an outbound message id (echo/loop protection in the gate). */
  readonly recordSentId: (key: WaMessageKey | null | undefined) => void;
  readonly logger?: TurnRunnerLogger;
}

export interface RunWhatsAppTurnOptions {
  readonly jid: string;
  readonly text: string;
  readonly model?: string | undefined;
  readonly controller: AbortController;
  /** Pre-minted turn id; the channel records it as an own-turn id (#8). */
  readonly turnId: ReturnType<typeof newTurnId>;
}

/**
 * Drive a single WhatsApp turn end-to-end: subscribe the frame pump to THIS
 * turn's events (turnId-filtered — `session.log` fans out to every listener, so
 * a concurrent turn on the same Session would otherwise stream into this chat,
 * AGENTS.md invariant #8), run the turn, flush the final frame, unwind in
 * `finally`.
 */
export async function runWhatsAppTurn(
  deps: RunWhatsAppTurnDeps,
  opts: RunWhatsAppTurnOptions,
): Promise<void> {
  const { session, socket, editFrameMs, recordSentId, logger } = deps;
  const { jid, text, model, controller, turnId } = opts;

  const renderer = new PlainTurnRenderer();

  const sendChunks = async (chunks: ReadonlyArray<string>): Promise<WaMessageKey | null> => {
    let firstKey: WaMessageKey | null = null;
    for (const chunk of chunks) {
      try {
        const sent = await socket.sendText(jid, chunk);
        recordSentId(sent?.key);
        if (!firstKey && sent?.key) firstKey = sent.key;
      } catch (err) {
        logger?.warn?.('whatsapp send failed', { err: String(err) });
      }
    }
    return firstKey;
  };

  const pump = new FramePump<WaMessageKey>({
    editFrameMs,
    frame: (final) => {
      const snapshot = renderer.snapshot();
      if (final || snapshot.length <= WHATSAPP_MAX_MESSAGE_CHARS) return snapshot;
      // Streaming frame: hold to one editable message; overflow waits for the
      // final flush, whose full text differs from this so a last flush is
      // guaranteed to deliver the tails.
      return `${snapshot.slice(0, WHATSAPP_MAX_MESSAGE_CHARS - 1)}…`;
    },
    emptyFinalText: '(no output)',
    sink: {
      send: async (t) => sendChunks(splitWhatsAppText(t)),
      edit: async (key, t, final) => {
        const chunks = splitWhatsAppText(t);
        const head = chunks[0];
        assertDefined(head, 'whatsapp: splitWhatsAppText always yields at least one chunk');
        try {
          await socket.editText(jid, key, head);
        } catch (err) {
          logger?.warn?.('whatsapp edit failed', { err: String(err), final });
          if (final) {
            // Never lose the final reply to a failed edit — resend it whole.
            await sendChunks(chunks);
            return;
          }
          return;
        }
        if (final && chunks.length > 1) await sendChunks(chunks.slice(1));
      },
    },
  });

  const unsubscribe = subscribeTurn(session, turnId, (event) => {
    if (renderer.accept(event)) pump.scheduleEdit();
  });

  try {
    await driveTurn(session, {
      turnId,
      prompt: text,
      ...(model ? { model } : {}),
      signal: controller.signal,
    });
    await pump.flush(true);
  } catch (err) {
    logger?.warn?.('whatsapp turn failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    await sendChunks([`Turn failed: ${err instanceof Error ? err.message : String(err)}`]);
  } finally {
    unsubscribe();
    pump.dispose();
  }
}

import type { newTurnId } from '@moxxy/core';
import { assertDefined, type ClientSession as Session } from '@moxxy/sdk';
import { FramePump, driveTurn, subscribeTurn } from '@moxxy/channel-kit';
import { DiscordTurnRenderer, splitForDiscord } from '../render.js';
import type { ChannelLogger, SendableChannelLike, SentMessageLike } from './discord-like.js';
import type { TypingIndicator } from './typing-indicator.js';
import type { CallTurnListener } from '../voice-call/call.js';

/**
 * Discord's per-channel edit budget is ~5 edits / 5s; the streaming edit
 * throttle must stay at or above 1200ms so a long turn never trips the rate
 * limiter (which would delay-queue frames and lag the stream).
 */
export const MIN_EDIT_FRAME_MS = 1_200;
export const DEFAULT_EDIT_FRAME_MS = 1_500;

/** Clamp a configured editFrameMs to the Discord-safe floor. */
export function clampEditFrameMs(requested: number | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return DEFAULT_EDIT_FRAME_MS;
  return Math.max(MIN_EDIT_FRAME_MS, requested);
}

export interface RunDiscordTurnDeps {
  readonly session: Session;
  readonly channel: SendableChannelLike;
  readonly typing: TypingIndicator;
  readonly editFrameMs: number;
  readonly logger?: ChannelLogger;
  /**
   * Called once with the FINAL assistant text after it has been flushed to the
   * channel (so the text reply always lands first). Backs the optional voice
   * reply. Best-effort — its failure is logged and never breaks the text turn.
   */
  readonly onFinalReply?: (text: string) => Promise<void>;
  /**
   * A call listening to the turn: the reply as it is written, piece by piece
   * (spoken sentence by sentence), and each approved step as it starts and
   * ends. A blank line marks where one assistant message ends, so text before
   * and after a tool call never runs into one sentence.
   */
  readonly spokenTurn?: CallTurnListener;
}

/**
 * What the model must know about replying on Discord: a `file://` link or a
 * local path is dead text there, so a file the user asks for has to go out as
 * an attachment through `discord_send_message`; and the user sees none of the
 * agent's panes, so a choice a page asks of them is asked in the chat.
 */
export const DISCORD_TURN_CONTEXT =
  'You are replying in a Discord chat. The user cannot open local paths or file:// links there. ' +
  'To give them a file from this computer (an image, a document, a video), call ' +
  '`discord_send_message` with `files: ["<absolute path>"]` — it arrives in their Discord DMs as an ' +
  'attachment they can open or download (10 MB per message at most) — then say briefly that you sent it. ' +
  'The user may be away from this computer and cannot see your browser or terminal from Discord (only ' +
  'the moxxy desktop app shows them, under Channels → Discord). When a page asks for a choice that ' +
  'belongs to them, such as a cookie banner, do not wait for them to click it: tell them in the chat ' +
  'what the page asks and name the options, then pick the one they choose. Something only they may ' +
  'enter (signing in, a one-time code, a CAPTCHA) cannot be done from Discord: say so, and that they can ' +
  'do it in the desktop app under Channels → Discord → Browser.';

/** Added when the reply is said out loud in a voice call. */
export const DISCORD_CALL_CONTEXT =
  'This message was spoken in a voice call and your reply will be read aloud: answer briefly, in ' +
  'plain spoken sentences, without markdown, code blocks, tables or links. The caller hears nothing ' +
  'while you work, so before you use tools, say in one short sentence what you are about to do ' +
  '(for example "Dobrze, sprawdzam logi."), and before each further step say in a few words what ' +
  'you are checking now. Speak in the language of the request.';

export interface RunDiscordTurnOptions {
  readonly text: string;
  /** The reply will be said out loud in a voice call. */
  readonly spoken?: boolean;
  readonly model?: string | undefined;
  readonly controller: AbortController;
  /** Pre-minted turn id; the channel records it as an own-turn id. */
  readonly turnId: ReturnType<typeof newTurnId>;
}

/**
 * Drive a single Discord turn end-to-end: start typing, subscribe the frame
 * pump to THIS turn's events (filtered by turnId — `session.log` fans out to
 * every listener, so a concurrent turn on the same Session would otherwise
 * stream into this channel, AGENTS.md invariant #8), run the turn, flush the
 * final frame, unwind in `finally`.
 *
 * The streaming loop is `@moxxy/channel-kit`'s {@link FramePump} ("send once,
 * then edit that message", throttled to `editFrameMs`) over a
 * {@link DiscordTurnRenderer} snapshot. Delivery handles the 2000-char cap:
 * mid-stream frames edit only the first split part; the FINAL frame sends the
 * overflow tail parts as follow-up messages (`alwaysFlushFinal` so the sink's
 * final-only work is never skipped).
 */
export async function runDiscordTurn(
  deps: RunDiscordTurnDeps,
  opts: RunDiscordTurnOptions,
): Promise<void> {
  const { session, channel, typing, editFrameMs, logger, onFinalReply, spokenTurn } = deps;
  const { text, model, controller, turnId } = opts;

  const renderer = new DiscordTurnRenderer();
  const sendPart = async (part: string): Promise<SentMessageLike | null> => {
    try {
      return await channel.send(part);
    } catch (err) {
      logger?.warn('discord send failed', { err: String(err) });
      return null;
    }
  };
  const pump = new FramePump<SentMessageLike>({
    editFrameMs,
    frame: () => renderer.snapshot(),
    // Guarantee at least one message even when the turn produced no text.
    emptyFinalText: '*(no output)*',
    // The sink does final-only work (split-overflow tails), so the final frame
    // must reach it even when the text didn't change since the last edit.
    alwaysFlushFinal: true,
    sink: {
      send: async (t, final) => {
        const parts = splitForDiscord(t);
        const head = parts[0];
        assertDefined(head, 'discord: FramePump never sinks empty text (emptyFinalText guarantees a part)');
        const sent = await sendPart(head);
        if (final) for (const tail of parts.slice(1)) await sendPart(tail);
        return sent;
      },
      edit: async (message, t, final) => {
        const parts = splitForDiscord(t);
        const head = parts[0];
        assertDefined(head, 'discord: FramePump never sinks empty text (emptyFinalText guarantees a part)');
        try {
          await message.edit(head);
        } catch (err) {
          logger?.warn('discord edit failed', { err: String(err) });
        }
        if (final) for (const tail of parts.slice(1)) await sendPart(tail);
      },
    },
  });

  typing.start(channel);
  let streamed = false;
  const requested = new Map<string, { readonly name: string; readonly input: unknown }>();
  const running = new Set<string>();
  const unsubscribe = subscribeTurn(session, turnId, (event) => {
    if (renderer.accept(event)) pump.scheduleEdit();
    if (!spokenTurn) return;
    switch (event.type) {
      case 'assistant_chunk':
        streamed = true;
        spokenTurn.text(event.delta);
        break;
      case 'assistant_message':
        if (!streamed && event.content) spokenTurn.text(event.content);
        streamed = false;
        spokenTurn.messageEnded();
        break;
      case 'tool_call_requested':
        requested.set(String(event.callId), { name: event.name, input: event.input });
        break;
      case 'tool_call_approved': {
        const callId = String(event.callId);
        const call = requested.get(callId);
        requested.delete(callId);
        if (!call) break;
        running.add(callId);
        spokenTurn.toolStarted(callId, call.name, call.input);
        break;
      }
      case 'tool_result':
        if (running.delete(String(event.callId))) spokenTurn.toolFinished(String(event.callId), event.ok);
        break;
      default:
        break;
    }
  });

  try {
    await driveTurn(session, {
      turnId,
      prompt: text,
      ...(model ? { model } : {}),
      systemPrompt: opts.spoken ? `${DISCORD_TURN_CONTEXT}\n\n${DISCORD_CALL_CONTEXT}` : DISCORD_TURN_CONTEXT,
      signal: controller.signal,
    });
    await pump.flush(true);
    // The text reply is now out. Speak the final assistant body if a voice
    // reply is wired — isolated so a synth/transcode/transport failure can
    // never break (or re-report) the already-delivered text turn.
    if (onFinalReply) {
      const finalText = renderer.finalText();
      if (finalText) {
        try {
          await onFinalReply(finalText);
        } catch (err) {
          logger?.warn('discord voice reply hook failed', {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } catch (err) {
    logger?.warn('discord turn failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    await sendPart(`Turn failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    typing.stop();
    unsubscribe();
    pump.dispose();
  }
}

import type { ClientSession as Session } from '@moxxy/sdk';
import { MAX_AUDIO_BYTES, type InboundAttachment } from '../schema.js';
import type { ChannelLogger } from './discord-like.js';
import type { InboundContext } from './message-handler.js';

/** Abort the attachment download if Discord's CDN hasn't responded in this window. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

export interface VoiceHandlerState {
  readonly session: Session | null;
  readonly busy: boolean;
}

export interface VoiceHandlerDeps {
  readonly logger?: ChannelLogger;
}

export interface VoiceHandlerCallbacks {
  readonly runUserTurn: (ctx: InboundContext, text: string) => Promise<void>;
  /** Override the network fetch for tests. Defaults to global `fetch`. */
  readonly fetchAudio?: (
    url: string,
    init?: { signal?: AbortSignal },
  ) => Promise<{
    ok: boolean;
    status?: number;
    statusText?: string;
    headers?: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
}

/** The first audio attachment on the message (Discord voice messages arrive as
 *  an `audio/ogg` attachment; uploaded audio files carry their own mime). */
export function pickAudioAttachment(
  attachments: ReadonlyArray<InboundAttachment>,
): InboundAttachment | null {
  return attachments.find((a) => (a.contentType ?? '').startsWith('audio/')) ?? null;
}

/**
 * Handle a Discord voice message / uploaded audio file. Called AFTER the
 * pairing + allow-list gate (the message handler owns authorization). Returns
 * true when the message carried audio and was consumed here (successfully or
 * not), false when there was no audio and the text path should proceed.
 *
 * Mirrors the Telegram voice handler: size caps (declared size, then
 * Content-Length, then the buffered body), bounded download, transcriber gate
 * with install guidance, a "heard:" echo, then a normal user turn.
 */
export async function handleVoiceMessage(
  ctx: InboundContext,
  state: VoiceHandlerState,
  deps: VoiceHandlerDeps,
  cb: VoiceHandlerCallbacks,
): Promise<boolean> {
  const audio = pickAudioAttachment(ctx.msg.attachments);
  if (!audio) return false;

  if (state.busy) {
    await ctx.reply('I am still working on the previous prompt. Send /cancel to abort it.');
    return true;
  }
  if (!state.session) {
    await ctx.reply('Session is not ready yet.');
    return true;
  }

  const transcriber = state.session.transcribers.tryGetActive();
  if (!transcriber) {
    await ctx.reply(
      'Heard a voice message, but no speech-to-text backend is configured. Install @moxxy/plugin-stt-whisper and run `moxxy login openai` (or set OPENAI_API_KEY) to enable voice input.',
    );
    return true;
  }

  // Reject oversized uploads up-front using the size Discord reports, before
  // we spend a download or any memory on it.
  if (audio.size > MAX_AUDIO_BYTES) {
    await ctx.reply(
      `That audio is too large (${Math.round(audio.size / (1024 * 1024))}MB). The limit is ${MAX_AUDIO_BYTES / (1024 * 1024)}MB.`,
    );
    return true;
  }

  const fetcher = cb.fetchAudio ?? ((u: string, init?: { signal?: AbortSignal }) => fetch(u, init));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
  let bytes: Uint8Array;
  try {
    const response = await fetcher(audio.url, { signal: ac.signal });
    if (!response.ok) {
      deps.logger?.warn('discord voice download failed', {
        ...(response.status !== undefined ? { status: response.status } : {}),
        ...(response.statusText ? { statusText: response.statusText } : {}),
      });
      await ctx.reply('Failed to download the voice message from Discord.');
      return true;
    }
    // Trust the Content-Length header (when present) to bail before buffering
    // a body that lies about its size on the attachment object.
    const declaredLen = Number(response.headers?.get('content-length') ?? '');
    if (Number.isFinite(declaredLen) && declaredLen > MAX_AUDIO_BYTES) {
      await ctx.reply('That audio is too large to transcribe.');
      return true;
    }
    const buf = await response.arrayBuffer();
    if (buf.byteLength > MAX_AUDIO_BYTES) {
      await ctx.reply('That audio is too large to transcribe.');
      return true;
    }
    bytes = new Uint8Array(buf);
  } catch (err) {
    deps.logger?.warn('discord voice fetch failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply(
      ac.signal.aborted
        ? 'Downloading the voice message timed out.'
        : 'Failed to download the voice message from Discord.',
    );
    return true;
  } finally {
    clearTimeout(timer);
  }

  const mimeType = audio.contentType ?? 'audio/ogg';
  let transcript: string;
  try {
    const result = await transcriber.transcribe(bytes, { mimeType });
    transcript = result.text.trim();
  } catch (err) {
    deps.logger?.warn('discord voice transcription failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    await ctx.reply(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  if (!transcript) {
    await ctx.reply('Could not transcribe the voice message (got empty text).');
    return true;
  }

  // Echo what we heard so the user can spot misrecognitions before the agent
  // acts on it. Italics keep it visually distinct from a normal reply.
  await ctx.reply(`*heard:* ${transcript}`);
  await cb.runUserTurn(ctx, transcript);
  return true;
}

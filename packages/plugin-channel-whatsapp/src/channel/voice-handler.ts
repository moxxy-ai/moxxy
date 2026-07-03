import type { ClientSession as Session } from '@moxxy/sdk';
import { MAX_AUDIO_BYTES } from '../message-gate.js';
import type { WaInboundMessage, WhatsAppSocket } from '../socket.js';

export interface VoiceHandlerDeps {
  readonly session: Session;
  readonly socket: WhatsAppSocket;
  /** Reply into the originating chat (records sent ids for echo protection). */
  readonly reply: (jid: string, text: string) => Promise<void>;
  readonly logger?: { warn?(msg: string, meta?: Record<string, unknown>): void };
}

export interface VoiceHandlerInput {
  readonly jid: string;
  readonly mimeType: string;
  /** The raw upsert message — Baileys needs it to decrypt/download the media. */
  readonly raw: WaInboundMessage;
}

/**
 * Handle an inbound voice note / audio message that already passed the gate
 * (pairing + allow-list + declared-size cap): require an active Transcriber
 * (guidance reply when none — mirror of the Telegram voice handler), download
 * via Baileys' media pipeline, re-check the size cap on the REAL bytes, then
 * transcribe. Returns the transcript for the caller to run as a normal user
 * turn, or null when the message was fully handled (guidance/error reply sent).
 */
export async function transcribeVoiceMessage(
  deps: VoiceHandlerDeps,
  input: VoiceHandlerInput,
): Promise<string | null> {
  const { session, socket, reply, logger } = deps;
  const { jid, mimeType, raw } = input;

  const transcriber = session.transcribers.tryGetActive();
  if (!transcriber) {
    await reply(
      jid,
      'Heard a voice note, but no speech-to-text backend is configured. Install ' +
        '@moxxy/plugin-stt-whisper and run `moxxy login openai` (or set OPENAI_API_KEY) ' +
        'to enable voice input.',
    );
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = await socket.downloadMedia(raw);
  } catch (err) {
    logger?.warn?.('whatsapp voice download failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    await reply(jid, 'Could not download that voice note.');
    return null;
  }
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    await reply(
      jid,
      `That audio is too large to transcribe (limit ${MAX_AUDIO_BYTES / (1024 * 1024)}MB).`,
    );
    return null;
  }

  let transcript: string;
  try {
    transcript = (await transcriber.transcribe(bytes, { mimeType })).text.trim();
  } catch (err) {
    logger?.warn?.('whatsapp voice transcription failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    await reply(jid, `Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!transcript) {
    await reply(jid, 'Could not transcribe the voice note (got empty text).');
    return null;
  }

  // Echo what was heard so the user can spot misrecognitions before the agent
  // acts on it (same contract as the Telegram voice handler).
  await reply(jid, `heard: ${transcript}`);
  return transcript;
}

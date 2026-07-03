import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ClientSession as Session } from '@moxxy/sdk';
import { attachmentIdSchema, type SignalAttachment } from '../schema.js';

/**
 * Voice-note handling for the Signal channel. signal-cli writes received
 * attachments to `<dataDir>/attachments/<id>` (it does NOT inline them in the
 * receive notification), so the flow is: pick the first audio attachment,
 * size-cap it, read the file, transcribe via the session's active Transcriber,
 * and hand the transcript back for a normal text turn.
 */

/**
 * Hard cap on an audio file we will buffer into memory before transcribing —
 * matches the Telegram channel's ceiling so an authorized-but-compromised
 * sender can't make the runner buffer an arbitrarily large blob.
 */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export interface VoiceLogger {
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface VoiceDeps {
  readonly session: Session;
  /** signal-cli's attachments dir (injectable for tests). */
  readonly attachmentsDir: string;
  /** Reply to the sender (guidance / error strings). */
  readonly reply: (text: string) => Promise<void>;
  /** Injectable file reader (tests). Defaults to fs.readFile. */
  readonly readFile?: (filePath: string) => Promise<Uint8Array>;
  readonly logger?: VoiceLogger;
}

/** The first audio attachment in a message, or null. */
export function pickAudioAttachment(
  attachments: ReadonlyArray<SignalAttachment> | undefined,
): SignalAttachment | null {
  if (!attachments) return null;
  return attachments.find((a) => (a.contentType ?? '').toLowerCase().startsWith('audio/')) ?? null;
}

/**
 * Transcribe a received audio attachment. Returns the transcript, or null when
 * the message was fully handled with a reply (no transcriber configured,
 * oversized, unreadable, transcription failed).
 */
export async function transcribeVoiceAttachment(
  deps: VoiceDeps,
  attachment: SignalAttachment,
): Promise<string | null> {
  const transcriber = deps.session.transcribers.tryGetActive();
  if (!transcriber) {
    await deps.reply(
      'Heard a voice note, but no speech-to-text backend is configured. Install @moxxy/plugin-stt-whisper ' +
        'and run `moxxy login openai` (or set OPENAI_API_KEY) to enable voice input.',
    );
    return null;
  }

  // Reject oversized audio up-front from the declared size, before any read.
  if (typeof attachment.size === 'number' && attachment.size > MAX_AUDIO_BYTES) {
    await deps.reply(
      `That audio is too large (${Math.round(attachment.size / (1024 * 1024))}MB). The limit is ${MAX_AUDIO_BYTES / (1024 * 1024)}MB.`,
    );
    return null;
  }

  // The id becomes a filename under signal-cli's attachments dir; re-validate
  // its charset here (defense in depth on top of the zod schema) so a crafted
  // id can never traverse out of the directory.
  const id = attachmentIdSchema.safeParse(attachment.id);
  if (!id.success) {
    deps.logger?.warn?.('signal: dropping voice note with invalid attachment id');
    return null;
  }
  const filePath = path.join(deps.attachmentsDir, id.data);

  const read = deps.readFile ?? ((p: string) => fs.readFile(p));
  let bytes: Uint8Array;
  try {
    bytes = await read(filePath);
  } catch (err) {
    deps.logger?.warn?.('signal: could not read voice attachment', {
      err: err instanceof Error ? err.message : String(err),
    });
    await deps.reply('Could not read that voice note from the signal-cli attachment store.');
    return null;
  }
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    await deps.reply('That audio is too large to transcribe.');
    return null;
  }

  let transcript: string;
  try {
    const result = await transcriber.transcribe(bytes, {
      mimeType: attachment.contentType ?? 'audio/aac',
    });
    transcript = result.text.trim();
  } catch (err) {
    deps.logger?.warn?.('signal: transcription failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    await deps.reply(`Transcription failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (!transcript) {
    await deps.reply('Could not transcribe the voice note (got empty text).');
    return null;
  }

  // Echo what we heard so the user can spot misrecognitions before the agent
  // acts on it (same UX as the Telegram voice path).
  await deps.reply(`heard: ${transcript}`);
  return transcript;
}

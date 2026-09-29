import { ensureOggOpus, synthesizeReply } from '@moxxy/channel-kit';
import { MOXXY_PCM16_24KHZ_MIME, type ClientSession } from '@moxxy/sdk';
import { decodeUtterance } from './pcm.js';

type SpeechSession = Pick<ClientSession, 'transcribers' | 'synthesizers'>;

/** One utterance of the call to text, through the session's active transcriber. */
export async function transcribeForCall(
  session: SpeechSession,
  packets: ReadonlyArray<Uint8Array>,
): Promise<string> {
  const transcriber = session.transcribers.tryGetActive();
  if (!transcriber) {
    throw new Error('no speech-to-text backend is configured — voice calls need one (e.g. `moxxy login openai-codex`)');
  }
  const pcm = await decodeUtterance(packets);
  if (pcm.byteLength === 0) return '';
  const { text } = await transcriber.transcribe(pcm, { mimeType: MOXXY_PCM16_24KHZ_MIME });
  return text.trim();
}

/** A reply as an Ogg/Opus clip for the call, or null when it cannot be voiced. */
export async function speakForCall(session: SpeechSession, text: string): Promise<Uint8Array | null> {
  const voiced = await synthesizeReply(session, text);
  if (!voiced.ok) return null;
  const clip = await ensureOggOpus(voiced.audio, voiced.mimeType);
  return clip.isOpus ? clip.audio : null;
}

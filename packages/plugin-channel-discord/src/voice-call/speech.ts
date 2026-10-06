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

/** A reply as an Ogg/Opus clip for the call, or null when it cannot be voiced
 *  (`onUnvoiced` hears why — a call otherwise just goes quiet). */
export async function speakForCall(
  session: SpeechSession,
  text: string,
  onUnvoiced?: (reason: string) => void,
  /** Picks the voice where the synthesizer has one per language (local Piper). */
  language?: string,
): Promise<Uint8Array | null> {
  const voiced = await synthesizeReply(session, text, language ? { language } : {});
  if (!voiced.ok) {
    onUnvoiced?.(voiced.error ?? voiced.reason);
    return null;
  }
  const clip = await ensureOggOpus(voiced.audio, voiced.mimeType);
  if (clip.isOpus) return clip.audio;
  onUnvoiced?.(`the voice is ${voiced.mimeType}, not Ogg/Opus`);
  return null;
}

/**
 * Cloud transcription for the desktop mic: OpenAI's audio transcription API on
 * the person's own OpenAI API key, read from the vault on every recording so a
 * key saved later works without a restart. Without a key it says what to do,
 * and never falls back to a ChatGPT login.
 */

import { MoxxyError, type Transcriber, type TranscribeOptions, type TranscriptionResult } from '@moxxy/sdk';
import { WhisperTranscriber } from '@moxxy/plugin-stt-whisper';

/** The vault entry every OpenAI feature shares (provider, voice, transcription). */
export const OPENAI_API_KEY_NAME = 'OPENAI_API_KEY';
/** OpenAI's recommended model for recorded audio; `whisper-1` is deprecated. */
export const OPENAI_TRANSCRIBE_MODEL = 'gpt-transcribe';
export const OPENAI_TRANSCRIBER_NAME = `openai-${OPENAI_TRANSCRIBE_MODEL}`;

export interface OpenAiTranscriberOptions {
  readonly vault: { get(name: string): Promise<string | null> };
  /** OpenAI's API by default; a loopback host in tests. */
  readonly baseURL?: string;
}

export function createOpenAiTranscriber(options: OpenAiTranscriberOptions): Transcriber {
  let cached: { readonly key: string; readonly transcriber: WhisperTranscriber } | null = null;

  const forKey = (key: string): WhisperTranscriber => {
    if (cached?.key !== key) {
      cached = {
        key,
        transcriber: new WhisperTranscriber({
          apiKey: key,
          model: OPENAI_TRANSCRIBE_MODEL,
          ...(options.baseURL ? { baseURL: options.baseURL } : {}),
        }),
      };
    }
    return cached.transcriber;
  };

  return {
    name: OPENAI_TRANSCRIBER_NAME,
    async transcribe(audio: Uint8Array | ArrayBuffer, opts?: TranscribeOptions): Promise<TranscriptionResult> {
      const key = (await options.vault.get(OPENAI_API_KEY_NAME))?.trim();
      if (!key) {
        throw new MoxxyError({
          code: 'AUTH_NO_CREDENTIALS',
          message: 'Choose a transcription in Settings → Voice and add your OpenAI API key, or switch to Local.',
          context: { provider: 'openai' },
        });
      }
      return forKey(key).transcribe(audio, opts);
    },
  };
}

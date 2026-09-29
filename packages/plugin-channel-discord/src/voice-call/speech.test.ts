import { describe, expect, it } from 'vitest';
import { Session } from '@moxxy/core';
import { MOXXY_PCM16_24KHZ_MIME, defineSynthesizer, defineTranscriber } from '@moxxy/sdk';
import { speakForCall, transcribeForCall } from './speech.js';

/** The 20 ms Opus silence frame Discord itself sends. */
const SILENCE_FRAME = new Uint8Array([0xf8, 0xff, 0xfe]);
const halfSecond = Array.from({ length: 25 }, () => SILENCE_FRAME);

function conversation() {
  return new Session({ cwd: '/tmp', silent: true });
}

describe('speech in a call', () => {
  it('hands the transcriber the utterance as 24 kHz PCM', async () => {
    const session = conversation();
    const heard: Array<{ bytes: number; mimeType?: string }> = [];
    session.transcribers.register(
      defineTranscriber({
        name: 'stt',
        createClient: () => ({
          name: 'stt',
          transcribe: async (audio, opts) => {
            heard.push({ bytes: (audio as Uint8Array).byteLength, mimeType: opts?.mimeType });
            return { text: '  cześć  ' };
          },
        }),
      }),
    );
    session.transcribers.setActive('stt');

    expect(await transcribeForCall(session, halfSecond)).toBe('cześć');
    expect(heard).toEqual([{ bytes: 12_000 * 2, mimeType: MOXXY_PCM16_24KHZ_MIME }]);
  });

  it('says what is missing when no speech-to-text backend is set up', async () => {
    await expect(transcribeForCall(conversation(), halfSecond)).rejects.toThrow(/speech-to-text/);
  });

  it('voices a reply as an Ogg/Opus clip the call can play', async () => {
    const session = conversation();
    const clip = new Uint8Array([79, 103, 103, 83]);
    session.synthesizers.register(
      defineSynthesizer({
        name: 'tts',
        create: () => ({ name: 'tts', synthesize: async () => ({ audio: clip, mimeType: 'audio/ogg' }) }),
      }),
    );
    session.synthesizers.setActive('tts');

    expect(await speakForCall(session, 'Gotowe.')).toEqual(clip);
  });

  it('has nothing to play when no voice is set up', async () => {
    expect(await speakForCall(conversation(), 'Gotowe.')).toBeNull();
  });
});

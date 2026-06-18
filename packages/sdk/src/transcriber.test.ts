import { describe, expect, it } from 'vitest';
import { MOXXY_PCM16_24KHZ_MIME } from './transcriber.js';

describe('MOXXY_PCM16_24KHZ_MIME', () => {
  it('locks the cross-package wire value', () => {
    // This is a PROTOCOL constant: the desktop/web capture path stamps it onto
    // the audio blob and the Codex transcriber keys on it to wrap the raw PCM
    // samples in a WAV header. Drift in the literal silently breaks
    // transcription with no compile-time signal — so pin the exact bytes here.
    expect(MOXXY_PCM16_24KHZ_MIME).toBe('audio/x-moxxy-pcm16-24khz');
  });
});

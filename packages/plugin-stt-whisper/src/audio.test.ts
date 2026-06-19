import { describe, expect, it } from 'vitest';
import { MOXXY_PCM16_24KHZ_MIME, normalizeWhisperUpload, pcm16MonoToWav } from './audio.js';

function ascii(bytes: Uint8Array, offset: number, len: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + len));
}

describe('pcm16MonoToWav', () => {
  it('writes a 44-byte canonical mono/16-bit WAV header for 24kHz', () => {
    const pcm = new Uint8Array(8); // 8 bytes of samples
    const wav = pcm16MonoToWav(pcm, 24_000);
    expect(wav.byteLength).toBe(44 + 8);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 8); // chunk size = 36 + data
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // PCM fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // audio format = PCM
    expect(view.getUint16(22, true)).toBe(1); // channels = mono
    expect(view.getUint32(24, true)).toBe(24_000); // sample rate
    expect(view.getUint32(28, true)).toBe(24_000 * 2); // byte rate = rate * blockAlign
    expect(view.getUint16(32, true)).toBe(2); // block align = channels * bytesPerSample
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8); // data chunk size
  });

  it('copies the PCM samples verbatim after the header', () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = pcm16MonoToWav(pcm, 24_000);
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4]);
  });
});

describe('normalizeWhisperUpload', () => {
  it('wraps raw PCM16 bytes in a WAV and reports audio/wav', () => {
    const pcm = new Uint8Array(4);
    const out = normalizeWhisperUpload(pcm, MOXXY_PCM16_24KHZ_MIME);
    expect(out.mimeType).toBe('audio/wav');
    expect(out.filename).toBe('audio.wav');
    expect(out.bytes.byteLength).toBe(44 + 4);
    expect(ascii(out.bytes, 0, 4)).toBe('RIFF');
  });

  it('brands the PCM16 WAV filename with a prefix when supplied', () => {
    const out = normalizeWhisperUpload(new Uint8Array(2), MOXXY_PCM16_24KHZ_MIME, 'moxxy');
    expect(out.filename).toBe('moxxy.wav');
    expect(out.mimeType).toBe('audio/wav');
  });

  it('passes non-PCM bytes through and infers the filename from the MIME table', () => {
    const bytes = new Uint8Array([9, 9]);
    const out = normalizeWhisperUpload(bytes, 'audio/ogg');
    expect(out.mimeType).toBe('audio/ogg');
    expect(out.filename).toBe('audio.ogg');
    expect(out.bytes).toBe(bytes); // no copy on passthrough
  });

  it('falls back to audio.bin for an unknown MIME', () => {
    const out = normalizeWhisperUpload(new Uint8Array(1), 'audio/weird');
    expect(out.filename).toBe('audio.bin');
    expect(out.mimeType).toBe('audio/weird');
  });

  it('keeps the inferred extension when branding the passthrough filename', () => {
    const out = normalizeWhisperUpload(new Uint8Array(1), 'audio/mpeg', 'moxxy');
    // audio/mpeg maps to audio.mp3 → branded as moxxy.mp3.
    expect(out.filename).toBe('moxxy.mp3');
  });

  it('defaults a missing MIME to audio/wav', () => {
    const out = normalizeWhisperUpload(new Uint8Array(1), undefined);
    expect(out.mimeType).toBe('audio/wav');
    expect(out.filename).toBe('audio.wav');
  });

  it('accepts an ArrayBuffer input', () => {
    const buf = new Uint8Array([5, 6, 7]).buffer;
    const out = normalizeWhisperUpload(buf, 'audio/ogg');
    expect([...out.bytes]).toEqual([5, 6, 7]);
  });

  it('degrades to the default when a non-string mimeType slips past the type', () => {
    // The Telegram path forwards `media.mime_type` from raw update JSON, which a
    // crafted message could make a number/object/array. `.toLowerCase()` would
    // throw on these; the runtime guard must fall back to audio/wav instead.
    for (const bad of [123, {}, [], true, Symbol('x')] as unknown[]) {
      const out = normalizeWhisperUpload(new Uint8Array([1]), bad as string | undefined);
      expect(out.mimeType).toBe('audio/wav');
      expect(out.filename).toBe('audio.wav');
    }
  });

  it('treats null mimeType like a missing one', () => {
    const out = normalizeWhisperUpload(new Uint8Array([1]), null as unknown as undefined);
    expect(out.mimeType).toBe('audio/wav');
    expect(out.filename).toBe('audio.wav');
  });
});

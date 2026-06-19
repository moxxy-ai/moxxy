/**
 * playAudioClip tests. This is the only TTS surface that handles UNTRUSTED,
 * unbounded input (a base64 audio clip from a runner-side synthesizer plugin),
 * so its worst-case invariants are what matter:
 *  - a valid clip decodes to a Blob object URL that is revoked EXACTLY ONCE on
 *    end (no URL leak, no double-revoke);
 *  - stop() revokes the object URL and is idempotent with a later onended;
 *  - malformed base64 (atob throws) degrades to the data: fallback WITHOUT
 *    throwing — the error still surfaces via the element's onerror;
 *  - audio.play() rejecting routes to onerror exactly once.
 *
 * The harness env is `node` (no DOM), so we stub atob / URL / Blob / Audio the
 * same way audio-capture.test.ts stubs the mic globals.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A controllable fake <audio> element: records the src it was built with and
 *  lets a test drive its lifecycle events and the play() promise. */
class FakeAudio {
  static last: FakeAudio | undefined;
  src: string;
  paused = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    FakeAudio.last = this;
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

let revoked: string[];
let created: string[];

beforeEach(() => {
  revoked = [];
  created = [];
  FakeAudio.last = undefined;
  let n = 0;
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => {
      const u = `blob:mock/${n++}`;
      created.push(u);
      return u;
    }),
    revokeObjectURL: vi.fn((u: string) => {
      revoked.push(u);
    }),
  });
  vi.stubGlobal('Blob', class {
    constructor(public parts: unknown[], public opts?: { type?: string }) {}
  });
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  // A real-ish atob: decode standard base64, throw on malformed input.
  vi.stubGlobal('atob', (b64: string) => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new Error('InvalidCharacterError');
    return Buffer.from(b64, 'base64').toString('binary');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadPlay() {
  vi.resetModules();
  const mod = await import('./tts.js');
  return mod.playAudioClip;
}

describe('playAudioClip', () => {
  it('decodes a valid clip to a Blob object URL and revokes it exactly once on end (no leak)', async () => {
    const playAudioClip = await loadPlay();
    const onend = vi.fn();
    const b64 = Buffer.from('hello pcm').toString('base64');

    playAudioClip(b64, 'audio/mpeg', { onend });
    expect(created).toHaveLength(1);
    expect(FakeAudio.last?.src).toBe(created[0]);

    // Engine signals natural completion.
    FakeAudio.last?.onended?.();
    expect(onend).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual([created[0]]);

    // A second onended must NOT double-revoke or re-fire the callback.
    FakeAudio.last?.onended?.();
    expect(onend).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual([created[0]]);
  });

  it('stop() revokes the object URL once and is idempotent with a later onended', async () => {
    const playAudioClip = await loadPlay();
    const onend = vi.fn();
    const handle = playAudioClip(Buffer.from('abc').toString('base64'), 'audio/mpeg', { onend });

    handle.stop();
    expect(FakeAudio.last?.paused).toBe(true);
    expect(revoked).toEqual([created[0]]);

    // stop() again + a stale onended must not revoke twice nor fire onend.
    handle.stop();
    FakeAudio.last?.onended?.();
    expect(revoked).toEqual([created[0]]);
    expect(onend).not.toHaveBeenCalled();
  });

  it('degrades to the data: fallback without throwing when base64 is malformed', async () => {
    const playAudioClip = await loadPlay();
    const onerror = vi.fn();

    // '@@@' makes the stubbed atob throw — must not propagate out of playAudioClip.
    expect(() => playAudioClip('@@@not-base64', 'audio/mpeg', { onerror })).not.toThrow();
    // No object URL was created (decode failed); the element got a data: URL so
    // the browser can surface the failure via onerror rather than a JS throw.
    expect(created).toHaveLength(0);
    expect(FakeAudio.last?.src.startsWith('data:audio/mpeg;base64,')).toBe(true);

    // The element later reports it can't decode → onerror fires once, no revoke
    // (there is no object URL to revoke).
    FakeAudio.last?.onerror?.();
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveLength(0);
  });

  it('routes a rejected play() to onerror exactly once and revokes the URL', async () => {
    const playAudioClip = await loadPlay();
    const onerror = vi.fn();
    const onend = vi.fn();

    // Make the audio created inside playAudioClip reject its play().
    // We can't reach the instance before it's built, so patch the prototype.
    const origPlay = FakeAudio.prototype.play;
    FakeAudio.prototype.play = function (this: FakeAudio) {
      return Promise.reject(new Error('NotAllowedError'));
    };
    try {
      playAudioClip(Buffer.from('zz').toString('base64'), 'audio/mpeg', { onerror, onend });
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      FakeAudio.prototype.play = origPlay;
    }

    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onend).not.toHaveBeenCalled();
    expect(revoked).toEqual([created[0]]);
  });
});

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
import { assertDefined } from '@moxxy/sdk';

/** A controllable fake <audio> element: records the src it was built with and
 *  lets a test drive its lifecycle events and the play() promise. */
class FakeAudio {
  static last: FakeAudio | undefined;
  static live: FakeAudio[] = [];
  src: string;
  paused = false;
  loop = false;
  loadCalls = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    FakeAudio.last = this;
    FakeAudio.live.push(this);
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
  /** Real `load()` aborts the current resource and frees the decoded audio. */
  load(): void {
    this.loadCalls += 1;
  }
}

let revoked: string[];
let created: string[];

beforeEach(() => {
  revoked = [];
  created = [];
  FakeAudio.last = undefined;
  FakeAudio.live = [];
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

async function loadPlayUrl() {
  vi.resetModules();
  const mod = await import('./tts.js');
  return mod.playAudioUrl;
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
    const audio = FakeAudio.last;
    assertDefined(audio, 'an audio element was created');
    audio.onended?.();
    expect(onend).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual([created[0]]);

    // A second onended must NOT double-revoke or re-fire the callback.
    audio.onended?.();
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
    const audio = FakeAudio.last;
    assertDefined(audio, 'an audio element was created');
    audio.onended?.();
    expect(revoked).toEqual([created[0]]);
    expect(onend).not.toHaveBeenCalled();
  });

  it('loops a waiting clip until its handle is stopped', async () => {
    const playAudioClip = await loadPlay();
    const handle = playAudioClip(
      Buffer.from('waiting tone').toString('base64'),
      'audio/wav',
      { loop: true },
    );

    expect(FakeAudio.last?.loop).toBe(true);
    handle.stop();
    expect(FakeAudio.last?.paused).toBe(true);
    expect(revoked).toEqual([created[0]]);
  });

  it('loops an application audio asset without creating an object URL', async () => {
    const playAudioUrl = await loadPlayUrl();
    const handle = playAudioUrl('/assets/voice-waiting-loop.wav', { loop: true });

    expect(FakeAudio.last?.src).toBe('/assets/voice-waiting-loop.wav');
    expect(FakeAudio.last?.loop).toBe(true);
    expect(created).toEqual([]);
    handle.stop();
    expect(revoked).toEqual([]);
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
    const audio = FakeAudio.last;
    assertDefined(audio, 'an audio element was created');
    audio.onerror?.();
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

  it('exposes a Web Audio analyser during Piper playback and releases it on end', async () => {
    const analyser = { connect: vi.fn(), disconnect: vi.fn() };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const close = vi.fn(async () => undefined);
    const resume = vi.fn(async () => undefined);
    const destination = { kind: 'destination' };
    const AudioContext = vi.fn(() => ({
      createMediaElementSource: vi.fn(() => source),
      createAnalyser: vi.fn(() => analyser),
      destination,
      close,
      resume,
    }));
    vi.stubGlobal('window', { AudioContext });
    const playAudioClip = await loadPlay();
    const onAnalyser = vi.fn();

    playAudioClip(Buffer.from('pcm').toString('base64'), 'audio/wav', { onAnalyser });

    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.connect).toHaveBeenCalledWith(destination);
    expect(onAnalyser).toHaveBeenCalledWith(analyser);

    const audio = FakeAudio.last;
    assertDefined(audio, 'an audio element was created');
    audio.onended?.();
    await Promise.resolve();

    expect(onAnalyser).toHaveBeenLastCalledWith(null);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
    // The context outlives the clip — see the sentence-boundary test below.
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps ONE audio context across clips instead of one per sentence', async () => {
    // Piper streams a sentence at a time, so a context built and torn down per
    // clip means opening and closing the audio device between every sentence —
    // which is audible as a cut right where the speech should run on.
    const makeNode = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const close = vi.fn(async () => undefined);
    const resume = vi.fn(async () => undefined);
    const AudioContext = vi.fn(() => ({
      createMediaElementSource: vi.fn(() => makeNode()),
      createAnalyser: vi.fn(() => makeNode()),
      destination: { kind: 'destination' },
      state: 'suspended',
      close,
      resume,
    }));
    vi.stubGlobal('window', { AudioContext });
    const playAudioClip = await loadPlay();
    const onAnalyser = vi.fn();

    for (let sentence = 0; sentence < 3; sentence += 1) {
      playAudioClip(Buffer.from(`s${sentence}`).toString('base64'), 'audio/wav', { onAnalyser });
      const audio = FakeAudio.last;
      assertDefined(audio, 'an audio element was created');
      audio.onended?.();
      await Promise.resolve();
    }

    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    // Every clip still gets its own analyser handed out and taken back.
    expect(onAnalyser).toHaveBeenCalledTimes(6);
    expect(onAnalyser).toHaveBeenLastCalledWith(null);
    // A context parked by the browser has to be woken for each clip.
    expect(resume).toHaveBeenCalledTimes(3);
  });

  it('releases the element and its decoded audio at the natural end, not just on stop()', async () => {
    // Closing the context per clip used to tear the whole graph down. With one
    // shared context that guarantee is gone, so every finish path has to hand
    // back its own element — otherwise a long conversation piles up one decoded
    // sentence per <audio> and waits on the garbage collector to notice.
    const makeNode = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const close = vi.fn(async () => undefined);
    vi.stubGlobal('window', {
      AudioContext: vi.fn(() => ({
        createMediaElementSource: vi.fn(() => makeNode()),
        createAnalyser: vi.fn(() => makeNode()),
        destination: { kind: 'destination' },
        state: 'running',
        close,
        resume: vi.fn(async () => undefined),
      })),
    });
    const playAudioClip = await loadPlay();
    const onend = vi.fn();

    for (let sentence = 0; sentence < 4; sentence += 1) {
      playAudioClip(Buffer.from(`s${sentence}`).toString('base64'), 'audio/wav', {
        onAnalyser: vi.fn(),
        onend,
      });
      const audio = FakeAudio.last;
      assertDefined(audio, 'an audio element was created');
      audio.onended?.();
      await Promise.resolve();
    }

    expect(onend).toHaveBeenCalledTimes(4);
    expect(FakeAudio.live).toHaveLength(4);
    expect(FakeAudio.live.every((audio) => audio.paused)).toBe(true);
    expect(FakeAudio.live.every((audio) => audio.src === '')).toBe(true);
    expect(FakeAudio.live.every((audio) => audio.loadCalls === 1)).toBe(true);
    // Detaching the handlers breaks element → closure → element, so nothing
    // keeps the finished clip reachable.
    expect(FakeAudio.live.every((audio) => audio.onended === null)).toBe(true);
    expect(FakeAudio.live.every((audio) => audio.onerror === null)).toBe(true);
    // Every object URL handed out was handed back.
    expect(revoked.sort()).toEqual(created.sort());
    expect(close).not.toHaveBeenCalled();
  });

  it('barge-in still cuts the sentence mid-clip, and the next one plays on', async () => {
    // Sharing the context must not weaken interruption: the cut comes from
    // pausing the element and unhooking THIS clip's nodes, never from tearing
    // the device down. The queue stops the active clip and pumps the next one.
    const nodes: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const makeNode = () => {
      const node = { connect: vi.fn(), disconnect: vi.fn() };
      nodes.push(node);
      return node;
    };
    const close = vi.fn(async () => undefined);
    const AudioContext = vi.fn(() => ({
      createMediaElementSource: vi.fn(() => makeNode()),
      createAnalyser: vi.fn(() => makeNode()),
      destination: { kind: 'destination' },
      state: 'running',
      close,
      resume: vi.fn(async () => undefined),
    }));
    vi.stubGlobal('window', { AudioContext });
    const playAudioClip = await loadPlay();
    const onAnalyser = vi.fn();
    const onend = vi.fn();

    const interrupted = playAudioClip(
      Buffer.from('half a sentence').toString('base64'),
      'audio/wav',
      { onAnalyser, onend },
    );
    const cut = FakeAudio.last;
    assertDefined(cut, 'the interrupted clip had an element');

    interrupted.stop();

    expect(cut.paused).toBe(true);
    expect(cut.src).toBe('');
    expect(nodes).toHaveLength(2);
    expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(onAnalyser).toHaveBeenLastCalledWith(null);
    // stop() is the queue discarding the clip, not the turn ending.
    expect(onend).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    // The reply that follows the interruption plays on the SAME device.
    playAudioClip(Buffer.from('the answer').toString('base64'), 'audio/wav', { onAnalyser });
    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(FakeAudio.last).not.toBe(cut);
    expect(FakeAudio.last?.paused).toBe(false);
    expect(onAnalyser).toHaveBeenLastCalledWith(nodes[3]);
  });
});

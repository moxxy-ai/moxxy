import { describe, expect, it, vi } from 'vitest';
import { VoiceCall, type VoiceLink } from './call.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(predicate: () => boolean, ms = 1_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(2);
  }
}

const BARGE_IN_MS = 30;
const packets = (n: number): Uint8Array[] => Array.from({ length: n }, () => new Uint8Array([1]));

/**
 * Stand-in for the Discord voice connection — the one external boundary of a
 * call. The test speaks through it (`say`) and hears what the bot plays.
 */
function fakeLink() {
  const started = new Set<() => void>();
  const ended = new Set<() => void>();
  const closed = new Set<() => void>();
  let pendingCapture: ((p: Uint8Array[]) => void) | null = null;
  let finishPlayback: (() => void) | null = null;
  const played: string[] = [];
  let stops = 0;
  let isClosed = false;
  const link: VoiceLink = {
    onSpeechStart: (fn) => {
      started.add(fn);
      return () => started.delete(fn);
    },
    onSpeechEnd: (fn) => {
      ended.add(fn);
      return () => ended.delete(fn);
    },
    onClosed: (fn) => {
      closed.add(fn);
      return () => closed.delete(fn);
    },
    captureUtterance: () =>
      new Promise((resolve) => {
        pendingCapture = resolve;
      }),
    play: (clip) =>
      new Promise((resolve) => {
        played.push(new TextDecoder().decode(clip));
        finishPlayback = () => {
          finishPlayback = null;
          resolve();
        };
      }),
    stop: () => {
      stops += 1;
      finishPlayback?.();
    },
    close: () => {
      isClosed = true;
      for (const fn of closed) fn();
    },
  };
  return {
    link,
    played,
    get stops() {
      return stops;
    },
    get closed() {
      return isClosed;
    },
    get playing() {
      return finishPlayback !== null;
    },
    startSpeaking: () => {
      for (const fn of started) fn();
    },
    stopSpeaking: () => {
      for (const fn of ended) fn();
    },
    /** The owner says something: speaking starts, then the utterance ends. */
    say: async (frames = packets(20)) => {
      for (const fn of started) fn();
      await until(() => pendingCapture !== null);
      for (const fn of ended) fn();
      const capture = pendingCapture;
      pendingCapture = null;
      capture?.(frames);
    },
    finishPlaying: () => finishPlayback?.(),
  };
}

/** The speech-to-text, agent and text-to-speech services, which the call
 *  reaches through plain functions. */
function services(overrides: Partial<{
  transcribe: (p: ReadonlyArray<Uint8Array>) => Promise<string>;
  answer: (text: string) => Promise<string | null>;
  speak: (text: string) => Promise<Uint8Array | null>;
}> = {}) {
  return {
    transcribe: vi.fn(overrides.transcribe ?? (async () => 'cześć')),
    answer: vi.fn(overrides.answer ?? (async (text: string) => `odpowiedź na: ${text}`)),
    speak: vi.fn(overrides.speak ?? (async (text: string) => new TextEncoder().encode(text))),
  };
}

function startCall(link: VoiceLink, deps: ReturnType<typeof services>) {
  return new VoiceCall(link, { ...deps, bargeInMs: BARGE_IN_MS, minPackets: 10 });
}

describe('a Discord voice call', () => {
  it('answers what the owner says out loud', async () => {
    const voice = fakeLink();
    const deps = services();
    startCall(voice.link, deps);

    await voice.say();

    await until(() => voice.played.length === 1);
    expect(deps.answer).toHaveBeenCalledWith('cześć');
    expect(voice.played).toEqual(['odpowiedź na: cześć']);
  });

  it('stops talking when the owner speaks over it', async () => {
    const voice = fakeLink();
    startCall(voice.link, services());
    await voice.say();
    await until(() => voice.playing);

    voice.startSpeaking();
    await sleep(BARGE_IN_MS * 3);

    expect(voice.stops).toBe(1);
    expect(voice.playing).toBe(false);
  });

  it('keeps talking through a short noise', async () => {
    const voice = fakeLink();
    startCall(voice.link, services());
    await voice.say();
    await until(() => voice.playing);

    voice.startSpeaking();
    voice.stopSpeaking();
    await sleep(BARGE_IN_MS * 3);

    expect(voice.stops).toBe(0);
    expect(voice.playing).toBe(true);
  });

  it('drops a reply the owner talked over while it was being voiced', async () => {
    const voice = fakeLink();
    let voiced: ((clip: Uint8Array) => void) | null = null;
    const deps = services({
      speak: () =>
        new Promise((resolve) => {
          voiced = resolve;
        }),
    });
    startCall(voice.link, deps);
    await voice.say();
    await until(() => voiced !== null);

    voice.startSpeaking();
    await sleep(BARGE_IN_MS * 3);
    voiced?.(new TextEncoder().encode('za późno'));
    await sleep(10);

    expect(voice.played).toEqual([]);
  });

  it('ignores a sound too short to be speech', async () => {
    const voice = fakeLink();
    const deps = services();
    startCall(voice.link, deps);

    await voice.say(packets(3));
    await sleep(10);

    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it('answers utterances one at a time, in the order they were said', async () => {
    const voice = fakeLink();
    const said = ['pierwsze', 'drugie'];
    const deps = services({ transcribe: async () => said.shift() ?? '' });
    startCall(voice.link, deps);

    await voice.say();
    await voice.say();
    await until(() => voice.played.length === 1);
    voice.finishPlaying();
    await until(() => voice.played.length === 2);

    expect(voice.played).toEqual(['odpowiedź na: pierwsze', 'odpowiedź na: drugie']);
  });

  it('says nothing more once the call is hung up', async () => {
    const voice = fakeLink();
    let answered: ((text: string) => void) | null = null;
    const deps = services({
      answer: () =>
        new Promise((resolve) => {
          answered = resolve;
        }),
    });
    const call = startCall(voice.link, deps);
    await voice.say();
    await until(() => answered !== null);

    call.hangUp();
    answered?.('już po rozmowie');
    await sleep(10);

    expect(voice.closed).toBe(true);
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it('ends when the voice connection drops', async () => {
    const voice = fakeLink();
    const ended = vi.fn();
    const call = startCall(voice.link, services());
    call.onEnded(ended);

    voice.link.close();

    expect(ended).toHaveBeenCalledOnce();
    expect(call.active).toBe(false);
  });

  it('says a first line of its own (a call the agent placed)', async () => {
    const voice = fakeLink();
    const call = startCall(voice.link, services());

    void call.say('Hej, skończyłem zadanie.');

    await until(() => voice.played.length === 1);
    expect(voice.played).toEqual(['Hej, skończyłem zadanie.']);
  });
});

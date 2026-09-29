import { describe, expect, it, vi } from 'vitest';
import { VoiceCall, type CallTurnListener, type VoiceLink } from './call.js';

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
type Answer = (text: string, turn: CallTurnListener) => Promise<void>;

function services(overrides: Partial<{
  transcribe: (p: ReadonlyArray<Uint8Array>) => Promise<string>;
  answer: Answer;
  speak: (text: string) => Promise<Uint8Array | null>;
}> = {}) {
  const answer: Answer = async (text, turn) => {
    turn.text(`odpowiedź na: ${text}`);
  };
  return {
    transcribe: vi.fn(overrides.transcribe ?? (async () => 'cześć')),
    answer: vi.fn(overrides.answer ?? answer),
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
    expect(deps.answer).toHaveBeenCalledWith('cześć', expect.objectContaining({ text: expect.any(Function) }));
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
    let answered: (() => void) | null = null;
    const deps = services({
      answer: (_text, turn) =>
        new Promise((resolve) => {
          answered = () => {
            turn.text('Już po rozmowie.');
            resolve();
          };
        }),
    });
    const call = startCall(voice.link, deps);
    await voice.say();
    await until(() => answered !== null);

    call.hangUp();
    answered?.();
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

describe('a reply said while the agent is still writing it', () => {
  it('starts talking before the agent has finished', async () => {
    const voice = fakeLink();
    startCall(voice.link, services({ answer: (_text, turn) => new Promise(() => turn.text('Już sprawdzam. ')) }));

    await voice.say();

    await until(() => voice.played.length === 1);
    expect(voice.played).toEqual(['Już sprawdzam.']);
  });

  it('talking over it also drops what the agent writes afterwards', async () => {
    const voice = fakeLink();
    let more: (() => void) | null = null;
    startCall(
      voice.link,
      services({
        answer: (_text, turn) =>
          new Promise((resolve) => {
            turn.text('Pierwsze. ');
            more = () => {
              turn.text('Drugie. ');
              resolve();
            };
          }),
      }),
    );
    await voice.say();
    await until(() => voice.playing);

    voice.startSpeaking();
    await sleep(BARGE_IN_MS * 3);
    more?.();
    await sleep(10);

    expect(voice.played).toEqual(['Pierwsze.']);
  });

  it('does not cut off a reply that has not started, and says it once it comes', async () => {
    const voice = fakeLink();
    let reply: (() => void) | null = null;
    startCall(
      voice.link,
      services({
        answer: (_text, turn) =>
          new Promise((resolve) => {
            reply = () => {
              turn.text('Gotowe.');
              resolve();
            };
          }),
      }),
    );
    await voice.say();
    await until(() => reply !== null);

    voice.startSpeaking();
    await sleep(BARGE_IN_MS * 3);
    voice.stopSpeaking();
    reply?.();

    await until(() => voice.played.length === 1);
    expect(voice.played).toEqual(['Gotowe.']);
  });
});

describe('a call while the agent works', () => {
  it('says which step it is on when the agent works without a word', async () => {
    const voice = fakeLink();
    let finish: (() => void) | null = null;
    startCall(
      voice.link,
      services({
        transcribe: async () => 'Sprawdź proszę pliki projektu.',
        answer: (_text, turn) =>
          new Promise((resolve) => {
            turn.toolStarted('c1', 'Read', { file_path: 'src/index.ts' });
            finish = () => {
              turn.toolFinished('c1', true);
              turn.text('Wszystko w porządku.');
              resolve();
            };
          }),
      }),
    );
    await voice.say();

    await until(() => voice.played.length === 1);
    finish?.();
    voice.finishPlaying();
    await until(() => voice.played.length === 2);

    expect(voice.played).toEqual(['Przeglądam pliki.', 'Wszystko w porządku.']);
  });

  it('adds no step of its own right after the agent said what it is doing', async () => {
    const voice = fakeLink();
    startCall(
      voice.link,
      services({
        transcribe: async () => 'Sprawdź proszę logi.',
        answer: (_text, turn) =>
          new Promise(() => {
            turn.text('Dobrze, sprawdzam logi.\n\n');
            turn.toolStarted('c1', 'Bash', { command: 'tail app.log' });
          }),
      }),
    );
    await voice.say();

    await until(() => voice.played.length === 1);
    voice.finishPlaying();
    await sleep(20);

    expect(voice.played).toEqual(['Dobrze, sprawdzam logi.']);
  });
});

import { describe, expect, it } from 'vitest';
import { SpokenReply } from './spoken-reply.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(predicate: () => boolean, ms = 1_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(2);
  }
}

/** The call's speaker (Discord voice) and voice (TTS) — both external. */
function speaker() {
  const played: string[] = [];
  const voiced: string[] = [];
  let finish: (() => void) | null = null;
  const pendingVoices = new Map<string, (clip: Uint8Array) => void>();
  return {
    played,
    voiced,
    get playing() {
      return finish !== null;
    },
    output: {
      play: (clip: Uint8Array) =>
        new Promise<void>((resolve) => {
          played.push(new TextDecoder().decode(clip));
          finish = () => {
            finish = null;
            resolve();
          };
        }),
      stop: () => finish?.(),
    },
    speak: (text: string) =>
      new Promise<Uint8Array | null>((resolve) => {
        voiced.push(text);
        pendingVoices.set(text, (clip) => resolve(clip));
      }),
    voice: (text: string) => pendingVoices.get(text)?.(new TextEncoder().encode(text)),
    finishPlaying: () => finish?.(),
  };
}

describe('a reply spoken sentence by sentence', () => {
  it('starts speaking the first sentence while the rest is still being written', async () => {
    const s = speaker();
    const reply = new SpokenReply(s.output, s.speak);

    reply.write('Już sprawdzam. Mam ');
    await until(() => s.voiced.length === 1);
    s.voice('Już sprawdzam.');

    await until(() => s.played.length === 1);
    expect(s.played).toEqual(['Już sprawdzam.']);
  });

  it('voices the next sentences ahead while one is playing', async () => {
    const s = speaker();
    const reply = new SpokenReply(s.output, s.speak);

    reply.write('Jeden. Dwa. Trzy. Cztery. ');
    await until(() => s.voiced.length >= 1);
    s.voice('Jeden.');
    await until(() => s.playing);

    expect(s.voiced).toEqual(['Jeden.', 'Dwa.', 'Trzy.']);
  });

  it('says every sentence in order, including an unfinished last one', async () => {
    const s = speaker();
    const reply = new SpokenReply(s.output, async (text) => new TextEncoder().encode(text));

    reply.write('Pierwsze. Drugie');
    reply.end();
    await until(() => s.played.length === 1);
    s.finishPlaying();
    await until(() => s.played.length === 2);
    s.finishPlaying();
    await reply.done;

    expect(s.played).toEqual(['Pierwsze.', 'Drugie']);
  });

  it('stops and drops the rest when cancelled, also what is written afterwards', async () => {
    const s = speaker();
    const reply = new SpokenReply(s.output, async (text) => new TextEncoder().encode(text));
    reply.write('Pierwsze. Drugie. ');
    await until(() => s.playing);

    reply.cancel();
    reply.write('Trzecie. ');
    reply.end();
    await reply.done;

    expect(s.played).toEqual(['Pierwsze.']);
    expect(s.playing).toBe(false);
  });

  it('skips a sentence that could not be voiced', async () => {
    const s = speaker();
    const reply = new SpokenReply(s.output, async (text) => (text === 'Zły.' ? null : new TextEncoder().encode(text)));

    reply.write('Zły. Dobry. ');
    reply.end();
    await until(() => s.played.length === 1);
    s.finishPlaying();
    await reply.done;

    expect(s.played).toEqual(['Dobry.']);
  });

  it('says a sentence of its own in turn and tells when it is heard', async () => {
    const s = speaker();
    const heard: boolean[] = [];
    const reply = new SpokenReply(s.output, s.speak, (audible) => heard.push(audible));

    reply.write('Najpierw to. Potem ');
    reply.interject('Przeglądam pliki.');
    await until(() => s.voiced.length === 2);
    s.voice('Najpierw to.');
    s.voice('Przeglądam pliki.');
    await until(() => s.played.length === 1);
    s.finishPlaying();
    await until(() => s.played.length === 2);
    s.finishPlaying();
    await sleep(10);

    expect(s.played).toEqual(['Najpierw to.', 'Przeglądam pliki.']);
    expect(heard).toEqual([true, false]);
  });
});


import { describe, expect, it } from 'vitest';
import { REPLY_CHIME, scheduleReplyChime } from './reply-chime';

/**
 * The browser's audio graph is the one thing outside this module, so it is
 * stood in for by a recorder of what was asked of it.
 */
interface Recorded {
  readonly frequency: number;
  readonly startedAt: number;
  readonly stoppedAt: number;
  readonly peak: number;
  readonly connected: boolean;
}

function fakeAudio(now: number): { readonly context: AudioContext; readonly voices: Recorded[] } {
  const voices: Recorded[] = [];
  const destination = {};
  const context = {
    currentTime: now,
    destination,
    createGain() {
      const gain = {
        peak: 0,
        out: null as unknown,
        gain: {
          setValueAtTime(value: number) { gain.peak = Math.max(gain.peak, value); },
          linearRampToValueAtTime(value: number) { gain.peak = Math.max(gain.peak, value); },
          exponentialRampToValueAtTime(value: number) { gain.peak = Math.max(gain.peak, value); },
        },
        connect(target: unknown) { gain.out = target; },
      };
      return gain;
    },
    createOscillator() {
      const voice = { frequency: 0, startedAt: -1, stoppedAt: -1, gain: null as null | { peak: number; out: unknown } };
      return {
        type: 'sine',
        frequency: { setValueAtTime(value: number) { voice.frequency = value; } },
        connect(target: { peak: number; out: unknown }) { voice.gain = target; },
        start(at: number) { voice.startedAt = at; },
        stop(at: number) {
          voice.stoppedAt = at;
          voices.push({
            frequency: voice.frequency,
            startedAt: voice.startedAt,
            stoppedAt: at,
            peak: voice.gain?.peak ?? 0,
            connected: voice.gain?.out === destination,
          });
        },
      };
    },
  };
  return { context: context as unknown as AudioContext, voices };
}

describe('the reply chime', () => {
  it('is two notes, the second higher and a moment after the first', () => {
    const { context, voices } = fakeAudio(10);

    scheduleReplyChime(context);

    expect(voices).toHaveLength(2);
    const [first, second] = voices;
    expect(first?.startedAt).toBe(10);
    expect(second?.startedAt).toBeGreaterThan(10);
    expect(second?.frequency).toBeGreaterThan(first?.frequency ?? Infinity);
    expect(voices.every((voice) => voice.connected)).toBe(true);
  });

  it('is quiet and short: a tap on the shoulder, not an alarm', () => {
    const { context, voices } = fakeAudio(0);

    scheduleReplyChime(context);

    for (const voice of voices) {
      expect(voice.peak).toBeGreaterThan(0);
      expect(voice.peak).toBeLessThanOrEqual(0.2);
      expect(voice.stoppedAt).toBeLessThanOrEqual(1);
    }
  });

  it('ends every note it starts, so nothing is left sounding', () => {
    const { context, voices } = fakeAudio(3);

    scheduleReplyChime(context);

    expect(voices.every((voice) => voice.stoppedAt > voice.startedAt)).toBe(true);
    expect(REPLY_CHIME.notes).toHaveLength(voices.length);
  });
});

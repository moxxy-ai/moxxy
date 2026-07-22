import { describe, expect, it } from 'vitest';
import { VoiceActivityDetector } from './voice-activity.js';

const config = {
  minSpeechMs: 120,
  silenceMs: 500,
  noSpeechTimeoutMs: 2_000,
  maxSpeechMs: 4_000,
  absoluteThreshold: 0.02,
} as const;

describe('VoiceActivityDetector', () => {
  it('waits for confirmed speech and ends only after sustained silence', () => {
    const detector = new VoiceActivityDetector(config);

    expect(detector.sample(0.004, 0)).toBe('none');
    expect(detector.sample(0.07, 100)).toBe('none');
    expect(detector.sample(0.08, 230)).toBe('speech-started');
    expect(detector.sample(0.06, 400)).toBe('none');
    expect(detector.sample(0.005, 750)).toBe('none');
    expect(detector.sample(0.004, 910)).toBe('speech-ended');
  });

  it('does not mistake stable room noise for speech', () => {
    const detector = new VoiceActivityDetector(config);

    for (let now = 0; now < 1_900; now += 50) {
      expect(detector.sample(0.008 + (now % 100) / 100_000, now)).toBe('none');
    }
    expect(detector.sample(0.008, 2_000)).toBe('no-speech-timeout');
  });

  it('does not let a single click start a speech segment', () => {
    const detector = new VoiceActivityDetector(config);

    expect(detector.sample(0.3, 100)).toBe('none');
    expect(detector.sample(0.004, 140)).toBe('none');
    expect(detector.sample(0.004, 500)).toBe('none');
  });

  it('bounds a continuous utterance even when silence never arrives', () => {
    const detector = new VoiceActivityDetector(config);

    expect(detector.sample(0.08, 0)).toBe('none');
    expect(detector.sample(0.08, 150)).toBe('speech-started');
    expect(detector.sample(0.08, 3_900)).toBe('none');
    expect(detector.sample(0.08, 4_150)).toBe('speech-ended');
  });

  it('can be reset for the next microphone capture', () => {
    const detector = new VoiceActivityDetector(config);
    detector.sample(0.08, 0);
    expect(detector.sample(0.08, 150)).toBe('speech-started');

    detector.reset();

    expect(detector.sample(0.004, 10_000)).toBe('none');
    expect(detector.sample(0.004, 11_999)).toBe('none');
    expect(detector.sample(0.004, 12_000)).toBe('no-speech-timeout');
  });
});

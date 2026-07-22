import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  calculateAnalyserRms,
  useVoiceActivityDetection,
} from './useVoiceActivityDetection';

class LevelAnalyser {
  fftSize = 32;
  level = 0;

  getFloatTimeDomainData(target: Float32Array): void {
    for (let index = 0; index < target.length; index += 1) {
      target[index] = index % 2 === 0 ? this.level : -this.level;
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('voice activity sampling', () => {
  it('calculates normalized RMS from a real time-domain buffer', () => {
    const analyser = new LevelAnalyser();
    analyser.level = 0.25;
    expect(calculateAnalyserRms(analyser as unknown as AnalyserNode)).toBeCloseTo(0.25, 4);
  });

  it('ends a confirmed utterance after sustained silence', () => {
    vi.useFakeTimers();
    const analyser = new LevelAnalyser();
    const onSpeechEnd = vi.fn();
    const onNoSpeech = vi.fn();
    renderHook(() => useVoiceActivityDetection({
      analyser: analyser as unknown as AnalyserNode,
      active: true,
      onSpeechEnd,
      onNoSpeech,
    }));

    analyser.level = 0.09;
    act(() => vi.advanceTimersByTime(280));
    analyser.level = 0.003;
    act(() => vi.advanceTimersByTime(1_000));

    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(onNoSpeech).not.toHaveBeenCalled();
  });

  it('rearms a silent capture instead of sending empty audio', () => {
    vi.useFakeTimers();
    const analyser = new LevelAnalyser();
    analyser.level = 0.003;
    const onSpeechEnd = vi.fn();
    const onNoSpeech = vi.fn();
    renderHook(() => useVoiceActivityDetection({
      analyser: analyser as unknown as AnalyserNode,
      active: true,
      onSpeechEnd,
      onNoSpeech,
    }));

    act(() => vi.advanceTimersByTime(30_100));

    expect(onNoSpeech).toHaveBeenCalledTimes(1);
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });
});

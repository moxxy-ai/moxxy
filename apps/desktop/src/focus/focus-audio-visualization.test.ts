import { describe, expect, it } from 'vitest';
import { deriveFocusAudioVisualization } from './focus-audio-visualization';

function analyser(seed: number): {
  readonly frequencyBinCount: number;
  readonly getByteFrequencyData: (data: Uint8Array) => void;
} {
  return {
    frequencyBinCount: 128,
    getByteFrequencyData: (data) => data.fill(seed),
  };
}

describe('deriveFocusAudioVisualization', () => {
  it('shows the live microphone analyser while a full voice conversation listens', () => {
    const input = analyser(24);

    expect(deriveFocusAudioVisualization({
      voiceModeActive: true,
      voiceInputAnalyser: input,
      voiceOutputAnalyser: null,
      oneShotRecording: false,
      oneShotAnalyser: null,
    })).toEqual({ analyser: input, source: 'microphone' });
  });

  it('prioritizes Piper output while Moxxy speaks', () => {
    const input = analyser(24);
    const output = analyser(96);

    expect(deriveFocusAudioVisualization({
      voiceModeActive: true,
      voiceInputAnalyser: input,
      voiceOutputAnalyser: output,
      oneShotRecording: false,
      oneShotAnalyser: null,
    })).toEqual({ analyser: output, source: 'assistant' });
  });

  it('keeps one-shot transcription visualization outside full Voice Mode only', () => {
    const oneShot = analyser(48);

    expect(deriveFocusAudioVisualization({
      voiceModeActive: false,
      voiceInputAnalyser: null,
      voiceOutputAnalyser: null,
      oneShotRecording: true,
      oneShotAnalyser: oneShot,
    })).toEqual({ analyser: oneShot, source: 'microphone' });

    expect(deriveFocusAudioVisualization({
      voiceModeActive: true,
      voiceInputAnalyser: null,
      voiceOutputAnalyser: null,
      oneShotRecording: true,
      oneShotAnalyser: oneShot,
    })).toBeNull();
  });

  it('rejects opaque values that cannot drive the spectrum canvas', () => {
    expect(deriveFocusAudioVisualization({
      voiceModeActive: true,
      voiceInputAnalyser: { frequencyBinCount: 128 },
      voiceOutputAnalyser: null,
      oneShotRecording: false,
      oneShotAnalyser: null,
    })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { createAnalyserLevelBuffers, readAnalyserLevel } from './voice-analyser-level';

function frequencyAnalyser(samples: ReadonlyArray<number>): unknown {
  return {
    frequencyBinCount: samples.length,
    getByteFrequencyData(target: Uint8Array) {
      samples.forEach((sample, index) => {
        target[index] = sample;
      });
    },
  };
}

function timeAnalyser(samples: ReadonlyArray<number>): unknown {
  return {
    fftSize: samples.length,
    getFloatTimeDomainData(target: Float32Array) {
      samples.forEach((sample, index) => {
        target[index] = sample;
      });
    },
  };
}

describe('voice analyser level', () => {
  it('reads a frequency analyser as its mean bin against a speech reference', () => {
    const buffers = createAnalyserLevelBuffers();

    expect(readAnalyserLevel(frequencyAnalyser([0, 0, 0, 0]), buffers)).toBe(0);
    expect(readAnalyserLevel(frequencyAnalyser([90, 90, 90, 90]), buffers)).toBeCloseTo(0.5, 6);
    expect(readAnalyserLevel(frequencyAnalyser([255, 255, 255, 255]), buffers)).toBe(1);
  });

  it('reads a time-domain analyser as its amplified RMS', () => {
    const buffers = createAnalyserLevelBuffers();

    expect(readAnalyserLevel(timeAnalyser([0, 0, 0, 0]), buffers)).toBe(0);
    expect(readAnalyserLevel(timeAnalyser([0.1, -0.1, 0.1, -0.1]), buffers)).toBeCloseTo(0.6, 6);
    expect(readAnalyserLevel(timeAnalyser([1, -1, 1, -1]), buffers)).toBe(1);
  });

  it('resizes its buffers to whatever the analyser reports', () => {
    const buffers = createAnalyserLevelBuffers();

    readAnalyserLevel(frequencyAnalyser(new Array(512).fill(180)), buffers);
    expect(buffers.frequency).toHaveLength(512);
    readAnalyserLevel(timeAnalyser(new Array(1_024).fill(0.2)), buffers);
    expect(buffers.time).toHaveLength(1_024);
    // Shrinking back must not read stale tail samples from the larger buffer.
    expect(readAnalyserLevel(frequencyAnalyser([0, 0]), buffers)).toBe(0);
  });

  it('reports silence for anything that is not an analyser', () => {
    const buffers = createAnalyserLevelBuffers();

    expect(readAnalyserLevel(null, buffers)).toBe(0);
    expect(readAnalyserLevel(undefined, buffers)).toBe(0);
    expect(readAnalyserLevel({}, buffers)).toBe(0);
    expect(readAnalyserLevel({ fftSize: 8 }, buffers)).toBe(0);
  });
});

import { useEffect, useRef } from 'react';
import { VoiceActivityDetector } from '@moxxy/client-core';

const SAMPLE_INTERVAL_MS = 40;
const OUTPUT_LEAK_RATIO = 0.1;

interface TimeDomainAnalyser {
  readonly fftSize: number;
  getFloatTimeDomainData(target: Float32Array): void;
}

function asTimeDomainAnalyser(value: unknown): TimeDomainAnalyser | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TimeDomainAnalyser>;
  if (
    typeof candidate.fftSize !== 'number' ||
    typeof candidate.getFloatTimeDomainData !== 'function'
  ) return null;
  return candidate as TimeDomainAnalyser;
}

export function calculateAnalyserRms(analyser: TimeDomainAnalyser): number {
  const samples = new Float32Array(Math.max(32, analyser.fftSize));
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function calculateEchoSafeRms(inputRms: number, outputRms: number): number {
  return Math.max(0, inputRms - outputRms * OUTPUT_LEAK_RATIO);
}

export function useVoiceActivityDetection({
  analyser,
  outputAnalyser,
  active,
  onSpeechStart,
  onSpeechEnd,
  onNoSpeech,
}: {
  readonly analyser: unknown | null;
  readonly outputAnalyser?: unknown | null;
  readonly active: boolean;
  readonly onSpeechStart?: () => void;
  readonly onSpeechEnd: () => void;
  readonly onNoSpeech: () => void;
}): void {
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef = useRef(onSpeechEnd);
  const onNoSpeechRef = useRef(onNoSpeech);
  const outputAnalyserRef = useRef(outputAnalyser);
  onSpeechStartRef.current = onSpeechStart;
  onSpeechEndRef.current = onSpeechEnd;
  onNoSpeechRef.current = onNoSpeech;
  outputAnalyserRef.current = outputAnalyser;

  useEffect(() => {
    const liveAnalyser = asTimeDomainAnalyser(analyser);
    if (!active || !liveAnalyser) return;
    const detector = new VoiceActivityDetector();
    const timer = window.setInterval(() => {
      const liveOutput = asTimeDomainAnalyser(outputAnalyserRef.current);
      const inputRms = calculateAnalyserRms(liveAnalyser);
      const outputRms = liveOutput ? calculateAnalyserRms(liveOutput) : 0;
      const signal = detector.sample(calculateEchoSafeRms(inputRms, outputRms), Date.now());
      if (signal === 'speech-started') onSpeechStartRef.current?.();
      if (signal === 'speech-ended') onSpeechEndRef.current();
      if (signal === 'no-speech-timeout') onNoSpeechRef.current();
    }, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, analyser]);
}

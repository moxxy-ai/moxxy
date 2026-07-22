import { useEffect, useRef } from 'react';
import { VoiceActivityDetector } from '@moxxy/client-core';

const SAMPLE_INTERVAL_MS = 40;

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

export function useVoiceActivityDetection({
  analyser,
  active,
  onSpeechEnd,
  onNoSpeech,
}: {
  readonly analyser: unknown | null;
  readonly active: boolean;
  readonly onSpeechEnd: () => void;
  readonly onNoSpeech: () => void;
}): void {
  const onSpeechEndRef = useRef(onSpeechEnd);
  const onNoSpeechRef = useRef(onNoSpeech);
  onSpeechEndRef.current = onSpeechEnd;
  onNoSpeechRef.current = onNoSpeech;

  useEffect(() => {
    const liveAnalyser = asTimeDomainAnalyser(analyser);
    if (!active || !liveAnalyser) return;
    const detector = new VoiceActivityDetector();
    const timer = window.setInterval(() => {
      const signal = detector.sample(calculateAnalyserRms(liveAnalyser), Date.now());
      if (signal === 'speech-ended') onSpeechEndRef.current();
      if (signal === 'no-speech-timeout') onNoSpeechRef.current();
    }, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, analyser]);
}

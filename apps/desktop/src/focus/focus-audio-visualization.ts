export interface AudioSpectrumAnalyser {
  readonly frequencyBinCount: number;
  getByteFrequencyData(data: Uint8Array): void;
}

export type FocusAudioSource = 'microphone' | 'assistant';

export interface FocusAudioVisualization {
  readonly analyser: AudioSpectrumAnalyser;
  readonly source: FocusAudioSource;
}

interface FocusAudioVisualizationInput {
  readonly voiceModeActive: boolean;
  readonly voiceInputAnalyser: unknown | null;
  readonly voiceOutputAnalyser: unknown | null;
  readonly oneShotRecording: boolean;
  readonly oneShotAnalyser: unknown | null;
}

function isAudioSpectrumAnalyser(value: unknown): value is AudioSpectrumAnalyser {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AudioSpectrumAnalyser>;
  return Number.isInteger(candidate.frequencyBinCount)
    && Number(candidate.frequencyBinCount) > 0
    && typeof candidate.getByteFrequencyData === 'function';
}

/** Selects the one live audio channel that should paint the compact Focus wave. */
export function deriveFocusAudioVisualization({
  voiceModeActive,
  voiceInputAnalyser,
  voiceOutputAnalyser,
  oneShotRecording,
  oneShotAnalyser,
}: FocusAudioVisualizationInput): FocusAudioVisualization | null {
  if (voiceModeActive) {
    if (isAudioSpectrumAnalyser(voiceOutputAnalyser)) {
      return { analyser: voiceOutputAnalyser, source: 'assistant' };
    }
    if (isAudioSpectrumAnalyser(voiceInputAnalyser)) {
      return { analyser: voiceInputAnalyser, source: 'microphone' };
    }
    return null;
  }

  if (oneShotRecording && isAudioSpectrumAnalyser(oneShotAnalyser)) {
    return { analyser: oneShotAnalyser, source: 'microphone' };
  }
  return null;
}

/**
 * One reading of "how loud is this voice stream right now", shared by every
 * surface that reacts to speech — the Voice Mode hologram and the Focus
 * widget's mark. Keeping the normalisation in one place is what makes the two
 * pulse in step; when each surface rolled its own, the same utterance drove
 * them to visibly different amplitudes.
 *
 * The caller owns the scratch buffers so a per-frame read allocates nothing.
 */

interface FrequencyAnalyser {
  readonly frequencyBinCount: number;
  getByteFrequencyData(target: Uint8Array): void;
}

interface TimeDomainAnalyser {
  readonly fftSize: number;
  getFloatTimeDomainData(target: Float32Array): void;
}

type Analyser =
  | { readonly kind: 'frequency'; readonly value: FrequencyAnalyser }
  | { readonly kind: 'time'; readonly value: TimeDomainAnalyser };

export interface AnalyserLevelBuffers {
  frequency: Uint8Array;
  time: Float32Array;
}

/** Mean bin value that counts as a full-scale level for speech. */
const FREQUENCY_REFERENCE = 180;
/** RMS gain: conversational speech sits well below full scale. */
const TIME_GAIN = 6;

export function createAnalyserLevelBuffers(): AnalyserLevelBuffers {
  return { frequency: new Uint8Array(64), time: new Float32Array(256) };
}

function asAnalyser(value: unknown): Analyser | null {
  if (typeof value !== 'object' || value === null) return null;
  const frequency = value as Partial<FrequencyAnalyser>;
  if (
    typeof frequency.frequencyBinCount === 'number'
    && typeof frequency.getByteFrequencyData === 'function'
  ) {
    return { kind: 'frequency', value: frequency as FrequencyAnalyser };
  }
  const time = value as Partial<TimeDomainAnalyser>;
  if (typeof time.fftSize === 'number' && typeof time.getFloatTimeDomainData === 'function') {
    return { kind: 'time', value: time as TimeDomainAnalyser };
  }
  return null;
}

/** `0` … `1`, or `0` for anything that is not a Web Audio analyser. */
export function readAnalyserLevel(source: unknown, buffers: AnalyserLevelBuffers): number {
  const analyser = asAnalyser(source);
  if (!analyser) return 0;
  if (analyser.kind === 'frequency') {
    const bins = Math.max(1, Math.floor(analyser.value.frequencyBinCount));
    if (buffers.frequency.length !== bins) buffers.frequency = new Uint8Array(bins);
    analyser.value.getByteFrequencyData(buffers.frequency);
    let total = 0;
    for (const sample of buffers.frequency) total += sample;
    return Math.min(1, total / buffers.frequency.length / FREQUENCY_REFERENCE);
  }
  const size = Math.max(1, Math.floor(analyser.value.fftSize));
  if (buffers.time.length !== size) buffers.time = new Float32Array(size);
  analyser.value.getFloatTimeDomainData(buffers.time);
  let squares = 0;
  for (const sample of buffers.time) squares += sample * sample;
  return Math.min(1, Math.sqrt(squares / buffers.time.length) * TIME_GAIN);
}

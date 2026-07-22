export type VoiceActivitySignal =
  | 'none'
  | 'speech-started'
  | 'speech-ended'
  | 'no-speech-timeout';

export interface VoiceActivityConfig {
  readonly minSpeechMs: number;
  readonly silenceMs: number;
  readonly noSpeechTimeoutMs: number;
  readonly maxSpeechMs: number;
  readonly absoluteThreshold: number;
}

const DEFAULT_CONFIG: VoiceActivityConfig = Object.freeze({
  minSpeechMs: 160,
  silenceMs: 900,
  noSpeechTimeoutMs: 30_000,
  maxSpeechMs: 90_000,
  absoluteThreshold: 0.018,
});

/**
 * Adaptive voice-activity detector fed with normalized RMS samples. It has no
 * browser dependency, which keeps the timing rules deterministic and reusable.
 */
export class VoiceActivityDetector {
  private readonly config: VoiceActivityConfig;
  private captureStartedAt: number | null = null;
  private candidateStartedAt: number | null = null;
  private speechStartedAt: number | null = null;
  private lastVoiceAt: number | null = null;
  private noiseFloor = 0.004;
  private terminal = false;

  constructor(config: Partial<VoiceActivityConfig> = {}) {
    this.config = Object.freeze({ ...DEFAULT_CONFIG, ...config });
  }

  reset(): void {
    this.captureStartedAt = null;
    this.candidateStartedAt = null;
    this.speechStartedAt = null;
    this.lastVoiceAt = null;
    this.noiseFloor = 0.004;
    this.terminal = false;
  }

  sample(rawLevel: number, nowMs: number): VoiceActivitySignal {
    if (this.terminal) return 'none';
    const level = Math.max(0, Math.min(1, rawLevel));
    if (this.captureStartedAt === null) this.captureStartedAt = nowMs;

    const threshold = Math.max(
      this.config.absoluteThreshold,
      this.noiseFloor * 3,
    );
    const voiced = level >= threshold;

    if (this.speechStartedAt === null) {
      if (voiced) {
        if (this.candidateStartedAt === null) this.candidateStartedAt = nowMs;
        if (nowMs - this.candidateStartedAt >= this.config.minSpeechMs) {
          this.speechStartedAt = this.candidateStartedAt;
          this.lastVoiceAt = nowMs;
          return 'speech-started';
        }
      } else {
        this.candidateStartedAt = null;
        // Learn only quiet input. A loud transient must not raise the floor and
        // make the following real sentence impossible to detect.
        if (level < this.config.absoluteThreshold) {
          this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05;
        }
      }

      if (nowMs - this.captureStartedAt >= this.config.noSpeechTimeoutMs) {
        this.terminal = true;
        return 'no-speech-timeout';
      }
      return 'none';
    }

    if (voiced) this.lastVoiceAt = nowMs;
    const speechDuration = nowMs - this.speechStartedAt;
    if (speechDuration >= this.config.maxSpeechMs) {
      this.terminal = true;
      return 'speech-ended';
    }
    if (
      !voiced &&
      this.lastVoiceAt !== null &&
      nowMs - this.lastVoiceAt >= this.config.silenceMs
    ) {
      this.terminal = true;
      return 'speech-ended';
    }
    return 'none';
  }
}

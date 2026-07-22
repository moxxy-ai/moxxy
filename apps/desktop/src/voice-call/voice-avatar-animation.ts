export type VoiceAvatarFrame = 'idle' | 'medium' | 'wide' | 'round' | 'blink';

export interface VoiceAvatarFrameInput {
  readonly speaking: boolean;
  readonly blinking: boolean;
  readonly amplitude: number;
  readonly mouthFrame: number;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Converts the byte-frequency frames used by the Focus bridge into 0…1. */
export function normalizeVoiceAvatarFrequencyLevel(data: Uint8Array): number {
  if (data.length === 0) return 0;
  const sampledBins = Math.min(data.length, 64);
  let sum = 0;
  for (let index = 0; index < sampledBins; index += 1) sum += data[index] ?? 0;
  const mean = sum / sampledBins;
  const noiseFloor = 12;
  return clampUnit((mean - noiseFloor) / 120);
}

/** Pure mouth-frame policy shared by the animation hook and deterministic tests. */
export function resolveVoiceAvatarFrame(input: VoiceAvatarFrameInput): VoiceAvatarFrame {
  if (input.blinking) return 'blink';
  if (!input.speaking || clampUnit(input.amplitude) < 0.07) return 'idle';
  if (input.mouthFrame % 6 === 0) return 'round';
  return input.amplitude >= 0.45 ? 'wide' : 'medium';
}

/** Exponential smoothing keeps short Piper peaks expressive without mouth jitter. */
export function smoothVoiceAvatarAmplitude(
  current: number,
  target: number,
  deltaSeconds: number,
): number {
  const safeCurrent = clampUnit(current);
  const safeTarget = clampUnit(target);
  const safeDelta = Math.min(0.1, Math.max(0, deltaSeconds));
  const smoothing = 1 - Math.exp(-12 * safeDelta);
  return clampUnit(safeCurrent + (safeTarget - safeCurrent) * smoothing);
}

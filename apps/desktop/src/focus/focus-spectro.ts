export const FOCUS_SPECTRO_BARS = 64;

const VOICE_SPECTRUM_BIN_LIMIT = 128;
const FULL_WIDTH_ENERGY_SHARE = 0.65;

interface FocusSpectroGradientStop {
  readonly offset: number;
  readonly color: string;
}

interface FocusSpectroGeometry {
  readonly barWidth: number;
  readonly step: number;
}

type FocusColorToken =
  | '--color-primary'
  | '--color-primary-strong'
  | '--color-action';

const FALLBACK_COLORS: Readonly<Record<FocusColorToken, string>> = {
  '--color-primary': '#ff4a1e',
  '--color-primary-strong': '#ff8a3d',
  '--color-action': '#d62a00',
};

function resolveToken(
  token: FocusColorToken,
  readToken: (token: FocusColorToken) => string,
): string {
  const value = readToken(token).trim();
  return value.length > 0 ? value : FALLBACK_COLORS[token];
}

/** Resolves the standalone Focus window's semantic Signal-orange palette. */
export function resolveFocusSpectroGradient(
  readToken: (token: FocusColorToken) => string,
): readonly FocusSpectroGradientStop[] {
  return [
    { offset: 0, color: resolveToken('--color-primary-strong', readToken) },
    { offset: 0.55, color: resolveToken('--color-primary', readToken) },
    { offset: 1, color: resolveToken('--color-action', readToken) },
  ];
}

/** Keeps every bar inside the canvas, including the final fractional pixel. */
export function resolveFocusSpectroGeometry(
  width: number,
  barCount: number,
  gap: number,
): FocusSpectroGeometry {
  if (width <= 0 || barCount <= 0) return { barWidth: 0, step: 0 };
  const availableGap = width / Math.max(1, barCount - 1);
  const safeGap = Math.min(Math.max(0, gap), availableGap);
  const totalGap = safeGap * Math.max(0, barCount - 1);
  const barWidth = Math.max(0, (width - totalGap) / barCount);
  return { barWidth, step: barWidth + safeGap };
}

/**
 * Projects the speech-dominant spectrum from the centre towards both edges.
 *
 * A conventional left-to-right frequency plot leaves the right half almost
 * idle for speech. Mirroring the useful voice band keeps the spectral shape,
 * while a restrained share of the RMS level lets the whole rail breathe with
 * the speaker instead of ending abruptly halfway across the panel.
 */
export function projectFocusSpectroLevels(
  spectrum: Uint8Array,
  levels: Float32Array,
): void {
  if (levels.length === 0) return;

  const useableBins = Math.min(spectrum.length, VOICE_SPECTRUM_BIN_LIMIT);
  if (useableBins === 0) {
    levels.fill(0);
    return;
  }

  let energySquared = 0;
  for (let index = 0; index < useableBins; index += 1) {
    const normalized = (spectrum[index] ?? 0) / 255;
    energySquared += normalized * normalized;
  }
  const voiceEnergy = Math.sqrt(energySquared / useableBins);
  const fullWidthFloor = voiceEnergy * FULL_WIDTH_ENERGY_SHARE;
  const halfBarCount = Math.ceil(levels.length / 2);
  const center = (levels.length - 1) / 2;

  for (let index = 0; index < levels.length; index += 1) {
    const mirroredIndex = Math.floor(Math.abs(index - center));
    const startRatio = mirroredIndex / halfBarCount;
    const endRatio = (mirroredIndex + 1) / halfBarCount;
    const start = Math.floor(Math.pow(startRatio, 1.6) * useableBins);
    const projectedEnd = Math.floor(Math.pow(endRatio, 1.6) * useableBins);
    const end = Math.min(useableBins, Math.max(start + 1, projectedEnd));

    let sum = 0;
    for (let bin = start; bin < end; bin += 1) sum += spectrum[bin] ?? 0;
    const localEnergy = sum / Math.max(1, end - start) / 255;
    const target = Math.max(localEnergy, fullWidthFloor);
    const previous = levels[index] ?? 0;
    const response = target > previous ? 0.42 : 0.22;
    levels[index] = previous * (1 - response) + target * response;
  }
}

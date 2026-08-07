import type { VoiceCallPhase } from '@moxxy/client-core';

export type HologramCrossing = 'under' | 'none' | 'over';
export const VOICE_HOLOGRAM_FILAMENT_COUNT = 11;

export interface HologramPoint {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
  readonly size: number;
  readonly brightness: number;
  readonly weave: number;
  readonly crossing: HologramCrossing;
  readonly strand: 0 | 1;
  readonly filament: number;
}

export interface OrbitPoint {
  readonly angle: number;
  readonly radius: number;
  readonly speed: number;
  readonly phase: number;
  readonly size: number;
}

export interface VoiceHologramField {
  readonly logo: ReadonlyArray<HologramPoint>;
  readonly orbits: ReadonlyArray<OrbitPoint>;
}

export interface HologramSegment {
  readonly start: HologramPoint;
  readonly end: HologramPoint;
  readonly crossing: HologramCrossing;
}

export interface VoiceHologramLayout {
  readonly centreX: number;
  readonly centreY: number;
  readonly radius: number;
}

export function resolveVoiceHologramLayout(width: number, height: number): VoiceHologramLayout {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  return Object.freeze({
    centreX: safeWidth / 2,
    centreY: safeHeight * 0.44,
    radius: Math.min(safeWidth * 0.25, safeHeight * 0.55, 205),
  });
}

export function resolveVoiceCanvasSize(
  width: number,
  height: number,
  devicePixelRatio: number,
): { readonly width: number; readonly height: number; readonly dpr: number } {
  const dpr = Math.max(1, Math.min(2, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  return Object.freeze({
    width: Math.max(0, Math.round(width * dpr)),
    height: Math.max(0, Math.round(height * dpr)),
    dpr,
  });
}

export interface RoundedSquareOptions {
  readonly count: number;
  readonly rotation: number;
  readonly scale?: number;
}

function createRandom(seed: number): () => number {
  let state = (Math.floor(Math.abs(seed)) >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function resolveCrossing(
  point: { readonly x: number; readonly y: number },
  strand: 0 | 1,
  progress: number,
): HologramCrossing {
  const period = Math.PI / 2;
  const crossingCentre = strand === 0 ? Math.PI / 4 : 0;
  const angle = progress * Math.PI * 2;
  const wrappedDistance = Math.abs(
    ((angle - crossingCentre + period / 2) % period + period) % period - period / 2,
  );
  if (wrappedDistance > 0.15) return 'none';
  const foregroundStrand = point.x * point.y >= 0 ? 1 : 0;
  return strand === foregroundStrand ? 'over' : 'under';
}

/** Samples a rounded square using a superellipse, then rotates it around zero. */
export function sampleRoundedSquare({
  count,
  rotation,
  scale = 0.7,
}: RoundedSquareOptions): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const safeCount = Math.max(8, Math.floor(count));
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const exponent = 0.42;
  const safeScale = Math.max(0.1, Math.min(0.8, scale));
  return Array.from({ length: safeCount }, (_, index) => {
    const angle = (index / (safeCount - 1)) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const squareX = Math.sign(cos) * Math.pow(Math.abs(cos), exponent) * safeScale;
    const squareY = Math.sign(sin) * Math.pow(Math.abs(sin), exponent) * safeScale;
    return Object.freeze({
      x: squareX * cosRotation - squareY * sinRotation,
      y: squareX * sinRotation + squareY * cosRotation,
    });
  });
}

export function buildVoiceHologramField({
  seed = 20260807,
  particleCount = 2_400,
}: {
  readonly seed?: number;
  readonly particleCount?: number;
} = {}): VoiceHologramField {
  const random = createRandom(seed);
  const count = Math.max(80, Math.floor(particleCount));
  const firstCount = Math.floor(count / 2);
  const filamentCount = VOICE_HOLOGRAM_FILAMENT_COUNT;
  const counts = [firstCount, count - firstCount] as const;
  const pathShape = (strand: number): Omit<RoundedSquareOptions, 'count'> => ({
    rotation: strand === 0 ? 0 : Math.PI / 4,
    scale: strand === 0 ? 0.54 : 0.64,
  });
  const paths = counts.map((pathCount, strand) => sampleRoundedSquare({
    count: Math.max(12, Math.ceil(pathCount / filamentCount)),
    ...pathShape(strand),
  }));
  const logo: HologramPoint[] = [];
  paths.forEach((path, strand) => {
    const typedStrand = strand as 0 | 1;
    const pathCount = counts[strand] ?? 0;
    for (let index = 0; index < pathCount; index += 1) {
      const pathIndex = Math.floor(index / filamentCount) % path.length;
      const point = path[pathIndex];
      const previous = path[(pathIndex - 1 + path.length) % path.length];
      const next = path[(pathIndex + 1) % path.length];
      if (!point || !previous || !next) continue;
      const tangentX = next.x - previous.x;
      const tangentY = next.y - previous.y;
      const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY));
      const normalX = -tangentY / tangentLength;
      const normalY = tangentX / tangentLength;
      const filament = index % filamentCount;
      const bandOffset = (filament - (filamentCount - 1) / 2) * 0.019;
      const jitter = (random() - 0.5) * 0.01;
      const progress = pathIndex / Math.max(1, path.length - 1);
      const crossing = resolveCrossing(point, typedStrand, progress);
      logo.push(Object.freeze({
        x: point.x + normalX * (bandOffset + jitter),
        y: point.y + normalY * (bandOffset + jitter),
        phase: random() * Math.PI * 2,
        size: 0.7 + random() * 1.45,
        brightness: 0.68 + random() * 0.32,
        weave: crossing === 'under' ? 0.82 : 1,
        crossing,
        strand: typedStrand,
        filament,
      }));
    }
  });

  const orbits = Array.from({ length: 72 }, (_, index): OrbitPoint => Object.freeze({
    angle: random() * Math.PI * 2,
    radius: 0.74 + random() * 0.25,
    speed: (index % 2 === 0 ? 1 : -1) * (0.035 + random() * 0.09),
    phase: random() * Math.PI * 2,
    size: 0.45 + random() * 1.1,
  }));

  return Object.freeze({ logo: Object.freeze(logo), orbits: Object.freeze(orbits) });
}

export function orderVoiceHologramParticles(
  particles: ReadonlyArray<HologramPoint>,
): ReadonlyArray<HologramPoint> {
  const rank: Readonly<Record<HologramCrossing, number>> = Object.freeze({
    under: 0,
    none: 1,
    over: 2,
  });
  return Object.freeze([...particles].sort((left, right) => (
    rank[left.crossing] - rank[right.crossing]
  )));
}

export function buildVoiceHologramSegments(
  points: ReadonlyArray<HologramPoint>,
): ReadonlyArray<HologramSegment> {
  if (points.length < 2) return Object.freeze([]);
  return Object.freeze(points.map((start, index) => {
    const end = points[(index + 1) % points.length];
    if (!end) throw new Error('Voice hologram segment requires a closing point');
    const crossing = start.crossing === 'none' ? end.crossing : start.crossing;
    return Object.freeze({ start, end, crossing });
  }));
}

export function groupVoiceHologramSegments(
  segments: ReadonlyArray<HologramSegment>,
  crossing: HologramCrossing,
): ReadonlyArray<ReadonlyArray<HologramSegment>> {
  const groups: HologramSegment[][] = [];
  let current: HologramSegment[] | undefined;
  for (const segment of segments) {
    if (segment.crossing !== crossing) {
      current = undefined;
      continue;
    }
    if (!current) {
      current = [];
      groups.push(current);
    }
    current.push(segment);
  }
  return Object.freeze(groups.map((group) => Object.freeze(group)));
}

export function resolveVoiceHologramEnergy(phase: VoiceCallPhase, audioLevel: number): number {
  const level = Number.isFinite(audioLevel) ? Math.max(0, Math.min(1, audioLevel)) : 0;
  if (phase === 'listening' || phase === 'speaking') return Math.max(0.18, level);
  if (phase === 'thinking' || phase === 'working' || phase === 'synthesizing') return 0.34;
  if (phase === 'transcribing' || phase === 'checking' || phase === 'arming') return 0.24;
  if (phase === 'error') return 0.16;
  if (phase === 'paused') return 0.08;
  return 0.14;
}

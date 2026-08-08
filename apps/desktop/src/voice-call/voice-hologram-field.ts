import type { VoiceCallPhase } from '@moxxy/client-core';

/** Which of the two ribbons a piece of the mark belongs to: `0` is the
 *  axis-aligned ink strand, `1` the 45°-turned accent strand. */
export type HologramStrand = 0 | 1;

/**
 * The Moxxy mark, in normalized units.
 *
 * The brand mark is ONE rounded square drawn twice — once flat, once turned a
 * quarter of a right angle — woven at the eight places the two centrelines
 * cross. The proportions are lifted verbatim from the shipped SVG (a 120-unit
 * square with `rx=12`, stroked 22 wide, woven through `r=27` masks) and then
 * divided through by the turned square's outer corner reach, so `1` is exactly
 * where the eight-pointed star ends and {@link resolveVoiceHologramLayout}'s
 * radius can be used as the mark's bounding radius.
 */
export interface HologramMark {
  /** Half the side of the ribbon's CENTRELINE square. */
  readonly half: number;
  /** Half the ribbon's material width — the centreline ± this is its edge. */
  readonly band: number;
  /** Corner radius of the centreline square. */
  readonly corner: number;
  /** Radius of the circular window each crossing is woven through. */
  readonly weave: number;
}

const MARK_REACH = ((60 + 11) * Math.SQRT2 - (12 + 11) * (Math.SQRT2 - 1)) / 60;

export const VOICE_HOLOGRAM_MARK: HologramMark = Object.freeze({
  half: 1 / MARK_REACH,
  band: (11 / 60) / MARK_REACH,
  corner: (12 / 60) / MARK_REACH,
  weave: (27 / 60) / MARK_REACH,
});

/** One arc-length step along a ribbon centreline, with its outward normal. */
export interface HologramSample {
  readonly x: number;
  readonly y: number;
  /** Outward unit normal — centreline + normal × band lands on the outer edge. */
  readonly nx: number;
  readonly ny: number;
  /** Arc-length position around the closed ring, `0 <= progress < 1`. */
  readonly progress: number;
}

/** A crossing of the two centrelines, and which strand passes in front there. */
export interface HologramCrossing {
  readonly x: number;
  readonly y: number;
  readonly over: HologramStrand;
}

/** One mote of the particle lattice that gives the ribbons their material. */
export interface HologramParticle {
  readonly strand: HologramStrand;
  /** Index into that strand's {@link HologramSample} ring. */
  readonly index: number;
  /** Position across the ribbon, `-1` inner edge … `+1` outer edge. */
  readonly offset: number;
  readonly size: number;
  readonly brightness: number;
  readonly phase: number;
}

/** A speck of the dust field the mark floats in. */
export interface HologramDust {
  readonly angle: number;
  /** Distance from the centre in mark radii — always outside the mark itself. */
  readonly radius: number;
  readonly size: number;
  readonly brightness: number;
  /** Angular drift per second. */
  readonly drift: number;
  readonly tint: HologramStrand;
}

/** A faint dotted circle in the backdrop. */
export interface HologramRing {
  readonly radius: number;
  readonly alpha: number;
  readonly dash: readonly [number, number];
}

export interface VoiceHologramField {
  readonly samples: readonly [ReadonlyArray<HologramSample>, ReadonlyArray<HologramSample>];
  readonly particles: ReadonlyArray<HologramParticle>;
  readonly dust: ReadonlyArray<HologramDust>;
  readonly rings: ReadonlyArray<HologramRing>;
}

export interface VoiceHologramLayout {
  readonly centreX: number;
  readonly centreY: number;
  readonly radius: number;
}

/**
 * Where the mark sits in a stage of `width × height`. The radius is the star's
 * outer reach, so the caps leave a margin the crossing flares and the outer
 * bloom can spill into without touching the transcript below.
 */
export function resolveVoiceHologramLayout(width: number, height: number): VoiceHologramLayout {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  return Object.freeze({
    centreX: safeWidth / 2,
    centreY: safeHeight * 0.45,
    radius: Math.min(safeWidth * 0.23, safeHeight * 0.4, 180),
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
  readonly half?: number;
  readonly corner?: number;
  readonly rotation?: number;
}

function createRandom(seed: number): () => number {
  let state = (Math.floor(Math.abs(seed)) >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Walk a rounded square at a CONSTANT arc-length step.
 *
 * Sampling by polar angle (the obvious shortcut) bunches points at the corners
 * and starves the straights, which shows up as a lumpy particle lattice. The
 * ring is built from one canonical quadrant — a straight edge followed by its
 * corner arc — turned through the other three, so the straights stay dead
 * straight and every sample carries the exact outward normal for its piece.
 */
export function sampleRoundedSquare({
  count,
  half = VOICE_HOLOGRAM_MARK.half,
  corner = VOICE_HOLOGRAM_MARK.corner,
  rotation = 0,
}: RoundedSquareOptions): ReadonlyArray<HologramSample> {
  const safeCount = Math.max(8, Math.floor(count));
  const safeHalf = Math.max(1e-6, half);
  const safeCorner = Math.max(0, Math.min(safeHalf, corner));
  const flat = safeHalf - safeCorner;
  const straight = 2 * flat;
  const arc = (Math.PI / 2) * safeCorner;
  const quadrant = straight + arc;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  return Object.freeze(Array.from({ length: safeCount }, (_, index): HologramSample => {
    const distance = (index / safeCount) * quadrant * 4;
    const turns = Math.min(3, Math.floor(distance / quadrant));
    const local = distance - turns * quadrant;
    let x: number;
    let y: number;
    let nx: number;
    let ny: number;
    if (local < straight) {
      x = safeHalf;
      y = -flat + local;
      nx = 1;
      ny = 0;
    } else {
      const theta = arc > 0 ? ((local - straight) / arc) * (Math.PI / 2) : 0;
      nx = Math.cos(theta);
      ny = Math.sin(theta);
      x = flat + safeCorner * nx;
      y = flat + safeCorner * ny;
    }
    // Each further quadrant is the canonical one turned a right angle; in a
    // y-down space that is (x, y) → (-y, x).
    for (let turn = 0; turn < turns; turn += 1) {
      [x, y] = [-y, x];
      [nx, ny] = [-ny, nx];
    }
    return Object.freeze({
      x: x * cosR - y * sinR,
      y: x * sinR + y * cosR,
      nx: nx * cosR - ny * sinR,
      ny: nx * sinR + ny * cosR,
      progress: index / safeCount,
    });
  }));
}

/**
 * The eight places the two centrelines cross, ordered by angle so the over /
 * under assignment simply alternates — which is what makes the two ribbons read
 * as woven rather than stacked. The flat square is in front at `(h, k·h)` and
 * its three quarter turns, matching the weave masks in the shipped mark.
 */
export function resolveHologramCrossings(
  mark: HologramMark = VOICE_HOLOGRAM_MARK,
): ReadonlyArray<HologramCrossing> {
  const near = (Math.SQRT2 - 1) * mark.half;
  const far = mark.half;
  const points: ReadonlyArray<readonly [number, number]> = [
    [-far, -near], [-near, -far], [near, -far], [far, -near],
    [far, near], [near, far], [-near, far], [-far, near],
  ];
  return Object.freeze(points.map(([x, y], index) => Object.freeze({
    x,
    y,
    over: (index % 2 === 0 ? 0 : 1) as HologramStrand,
  })));
}

/** Rows of particles laid across the ribbon; an odd count keeps a centre row. */
const LATTICE_ROWS = 9;

/** Radii (in mark radii) of the dotted rings the mark floats inside. */
const RING_RADII: ReadonlyArray<number> = [1.14, 1.3, 1.47, 1.66, 1.88];

export function buildVoiceHologramField({
  seed = 20260808,
  particleCount = 2_600,
  sampleCount = 480,
}: {
  readonly seed?: number;
  readonly particleCount?: number;
  readonly sampleCount?: number;
} = {}): VoiceHologramField {
  const random = createRandom(seed);
  const ring = Math.max(64, Math.floor(sampleCount));
  const samples = [
    sampleRoundedSquare({ count: ring, rotation: 0 }),
    sampleRoundedSquare({ count: ring, rotation: Math.PI / 4 }),
  ] as const;

  const perStrand = Math.max(LATTICE_ROWS, Math.floor(Math.max(80, particleCount) / 2));
  const columns = Math.max(2, Math.round(perStrand / LATTICE_ROWS));
  const particles: HologramParticle[] = [];
  for (const strand of [0, 1] as const) {
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < LATTICE_ROWS; row += 1) {
        const along = (column + (random() - 0.5) * 0.7) / columns;
        const across = (row / (LATTICE_ROWS - 1)) * 2 - 1 + (random() - 0.5) * 0.11;
        particles.push(Object.freeze({
          strand,
          index: ((Math.round(along * ring) % ring) + ring) % ring,
          offset: Math.max(-1, Math.min(1, across)),
          size: 0.5 + random() * 1.35,
          brightness: 0.5 + random() * 0.5,
          phase: random() * Math.PI * 2,
        }));
      }
    }
  }

  const dust = Array.from({ length: 220 }, (_, index): HologramDust => {
    const onRing = index % 3 !== 0;
    const anchor = RING_RADII[index % RING_RADII.length] ?? 1.4;
    return Object.freeze({
      angle: random() * Math.PI * 2,
      radius: onRing
        ? anchor + (random() - 0.5) * 0.05
        : 1.04 + random() * 1.5,
      size: 0.45 + random() * 1.15,
      brightness: 0.2 + random() * 0.8,
      drift: (index % 2 === 0 ? 1 : -1) * (0.008 + random() * 0.03),
      tint: (random() > 0.62 ? 0 : 1) as HologramStrand,
    });
  });

  const rings = RING_RADII.map((radius, index) => Object.freeze({
    radius,
    alpha: 0.12 - index * 0.017,
    dash: [1, 7 + index * 3] as const,
  }));

  return Object.freeze({
    samples,
    particles: Object.freeze(particles),
    dust: Object.freeze(dust),
    rings: Object.freeze(rings),
  });
}

/** Radians per second the mark turns at nominal phase speed. A quarter turn is
 *  a whole visual loop for a mark symmetric under 90°, and lands every ~8s —
 *  fast enough to read as motion, slow enough to sit behind a conversation. */
export const VOICE_HOLOGRAM_SPIN_RATE = 0.2;

/** Longest frame the spin will integrate. A backgrounded tab hands back one
 *  enormous delta on its first frame; without this the mark would snap. */
const MAX_SPIN_STEP_MS = 64;

/**
 * Advance the mark's clockwise turn by one frame.
 *
 * The angle is ACCUMULATED rather than derived from the timestamp so that a
 * phase change (which scales `speed`) eases into the new rate instead of
 * teleporting the mark. Wrapping at a whole turn — not at the 90° symmetry
 * period — keeps the accumulator bounded without snapping the particle
 * lattice, whose per-mote grain is only invariant under a full revolution.
 */
export function advanceVoiceHologramSpin(
  spin: number,
  elapsedMs: number,
  speed: number,
): number {
  const turn = Number.isFinite(spin) ? spin : 0;
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(speed)) return turn;
  const step = Math.max(0, Math.min(MAX_SPIN_STEP_MS, elapsedMs));
  const advanced = turn + (step / 1_000) * VOICE_HOLOGRAM_SPIN_RATE * speed;
  const full = Math.PI * 2;
  return ((advanced % full) + full) % full;
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

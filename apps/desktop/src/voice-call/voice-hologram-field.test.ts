import { describe, expect, it } from 'vitest';
import {
  advanceVoiceHologramSpin,
  buildVoiceHologramField,
  resolveHologramCrossings,
  resolveVoiceCanvasSize,
  resolveVoiceHologramEnergy,
  resolveVoiceHologramLayout,
  sampleRoundedSquare,
  shouldPaintVoiceHologramFrame,
  VOICE_HOLOGRAM_MARK,
  VOICE_HOLOGRAM_SPIN_RATE,
} from './voice-hologram-field';

const { half, band, corner } = VOICE_HOLOGRAM_MARK;

describe('voice hologram geometry', () => {
  it('normalises the mark so the woven diamond just reaches the layout radius', () => {
    const outerHalf = half + band;
    const outerCorner = corner + band;
    const diamondReach = outerHalf * Math.SQRT2 - outerCorner * (Math.SQRT2 - 1);

    expect(diamondReach).toBeCloseTo(1, 2);
    // Both strands are the SAME square — the brand mark is one shape rotated.
    expect(band / half).toBeCloseTo(11 / 60, 2);
    expect(corner / half).toBeCloseTo(12 / 60, 2);
  });

  it('samples a rounded square with straight edges and outward unit normals', () => {
    const samples = sampleRoundedSquare({ count: 400, half, corner, rotation: 0 });

    expect(samples).toHaveLength(400);
    expect(samples.every(({ nx, ny }) => Math.abs(Math.hypot(nx, ny) - 1) < 1e-9)).toBe(true);
    expect(samples.every(({ x, y }) => Math.abs(x) <= half + 1e-9 && Math.abs(y) <= half + 1e-9)).toBe(true);

    const rightEdge = samples.filter(({ x }) => Math.abs(x - half) < 1e-12);
    expect(rightEdge.length).toBeGreaterThan(40);
    expect(rightEdge.every(({ nx, ny }) => nx === 1 && ny === 0)).toBe(true);
  });

  it('walks the perimeter at a constant arc-length step and closes the loop', () => {
    const samples = sampleRoundedSquare({ count: 240, half, corner, rotation: 0 });
    const steps = samples.map((point, index) => {
      const next = samples[(index + 1) % samples.length];
      if (!next) throw new Error('closed sample ring required');
      return Math.hypot(next.x - point.x, next.y - point.y);
    });

    const largest = Math.max(...steps);
    const smallest = Math.min(...steps);
    expect(largest / smallest).toBeLessThan(1.02);
    expect(samples.map((point) => point.progress)).toEqual([...samples.map((point) => point.progress)].sort(
      (left, right) => left - right,
    ));
  });

  it('rotates the sampled ring rigidly', () => {
    const flat = sampleRoundedSquare({ count: 120, half, corner, rotation: 0 });
    const turned = sampleRoundedSquare({ count: 120, half, corner, rotation: Math.PI / 4 });
    const cos = Math.cos(Math.PI / 4);
    const sin = Math.sin(Math.PI / 4);

    turned.forEach((point, index) => {
      const source = flat[index];
      if (!source) throw new Error('matching sample required');
      expect(point.x).toBeCloseTo(source.x * cos - source.y * sin, 9);
      expect(point.y).toBeCloseTo(source.x * sin + source.y * cos, 9);
    });
  });

  it('resolves the eight woven crossings with an alternating over-strand', () => {
    const crossings = resolveHologramCrossings();
    const inset = (Math.SQRT2 - 1) * half;

    expect(crossings).toHaveLength(8);
    // Every crossing sits on the axis-aligned centreline...
    expect(crossings.every(({ x, y }) => (
      Math.abs(Math.abs(x) - half) < 1e-9 || Math.abs(Math.abs(y) - half) < 1e-9
    ))).toBe(true);
    // ...and on the diagonal centreline.
    expect(crossings.every(({ x, y }) => (
      Math.abs(Math.abs(x + y) - half * Math.SQRT2) < 1e-6
        || Math.abs(Math.abs(x - y) - half * Math.SQRT2) < 1e-6
    ))).toBe(true);
    expect(crossings.filter(({ over }) => over === 0)).toHaveLength(4);
    expect(crossings.filter(({ over }) => over === 1)).toHaveLength(4);
    // The brand mark puts the ink strand over at (h, k·h) and its three turns.
    expect(crossings.filter(({ over }) => over === 0).map(({ x, y }) => [
      Math.round(x * 1e6) / 1e6,
      Math.round(y * 1e6) / 1e6,
    ])).toEqual(expect.arrayContaining([
      [Math.round(half * 1e6) / 1e6, Math.round(inset * 1e6) / 1e6],
    ]));
    const angles = crossings.map(({ x, y }) => Math.atan2(y, x));
    expect(angles).toEqual([...angles].sort((left, right) => left - right));
    expect(crossings.every((crossing, index) => (
      index === 0 || crossing.over !== crossings[index - 1]?.over
    ))).toBe(true);
  });

  it('builds a deterministic lattice that fills both ribbons edge to edge', () => {
    const first = buildVoiceHologramField({ seed: 42, particleCount: 600 });
    const second = buildVoiceHologramField({ seed: 42, particleCount: 600 });

    expect(first).toEqual(second);
    expect(first.samples).toHaveLength(2);
    expect(new Set(first.particles.map((particle) => particle.strand))).toEqual(new Set([0, 1]));
    expect(first.particles.every((particle) => Math.abs(particle.offset) <= 1)).toBe(true);
    expect(Math.max(...first.particles.map((particle) => particle.offset))).toBeGreaterThan(0.9);
    expect(Math.min(...first.particles.map((particle) => particle.offset))).toBeLessThan(-0.9);
    expect(first.particles.every((particle) => (
      particle.index >= 0 && particle.index < first.samples[0].length
    ))).toBe(true);
  });

  it('spreads the lattice around the whole ribbon rather than bunching at the seam', () => {
    const field = buildVoiceHologramField({ seed: 7, particleCount: 1_200 });
    const length = field.samples[0].length;
    const quarters = [0, 0, 0, 0];
    for (const particle of field.particles) {
      if (particle.strand !== 0) continue;
      const quarter = Math.min(3, Math.floor((particle.index / length) * 4));
      quarters[quarter] = (quarters[quarter] ?? 0) + 1;
    }

    expect(Math.min(...quarters)).toBeGreaterThan(0);
    expect(Math.max(...quarters) / Math.min(...quarters)).toBeLessThan(1.6);
  });

  it('scatters the dust field on concentric rings outside the mark', () => {
    const field = buildVoiceHologramField({ seed: 11, particleCount: 600 });

    expect(field.rings.length).toBeGreaterThanOrEqual(3);
    expect(field.rings.every((ring) => ring.radius > 1)).toBe(true);
    expect(field.rings.map((ring) => ring.radius)).toEqual(
      [...field.rings.map((ring) => ring.radius)].sort((left, right) => left - right),
    );
    expect(field.dust.length).toBeGreaterThan(80);
    expect(field.dust.every((mote) => mote.radius > 1 && mote.radius < 2.6)).toBe(true);
    expect(new Set(field.dust.map((mote) => mote.tint))).toEqual(new Set([0, 1]));
  });

  it('keeps the holographic mark centred with room for its crossing flares', () => {
    const layout = resolveVoiceHologramLayout(900, 390);

    expect(layout.centreX).toBe(450);
    expect(layout.centreY).toBeCloseTo(175.5, 5);
    expect(layout.radius).toBeCloseTo(156, 5);
    expect(layout.radius).toBeLessThan(390 / 2);
    expect(resolveVoiceHologramLayout(760, 360).radius).toBeGreaterThanOrEqual(140);
  });

  it('turns the mark clockwise at a rate the phase scales', () => {
    expect(advanceVoiceHologramSpin(0, 50, 1)).toBeCloseTo(VOICE_HOLOGRAM_SPIN_RATE * 0.05, 12);
    expect(advanceVoiceHologramSpin(0, 40, 2)).toBeCloseTo(
      advanceVoiceHologramSpin(0, 40, 1) * 2,
      12,
    );
    expect(advanceVoiceHologramSpin(0.5, 16, 1)).toBeGreaterThan(0.5);
    expect(advanceVoiceHologramSpin(0.5, 0, 1)).toBe(0.5);
  });

  it('wraps a whole turn so the accumulator never drifts out of range', () => {
    const step = VOICE_HOLOGRAM_SPIN_RATE * 0.05;
    const wrapped = advanceVoiceHologramSpin(Math.PI * 2 - step / 2, 50, 1);

    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(Math.PI * 2);
    expect(wrapped).toBeCloseTo(step / 2, 9);
  });

  it('clamps a stalled frame so a backgrounded tab cannot jump the mark', () => {
    expect(advanceVoiceHologramSpin(0, 5_000, 1)).toBe(advanceVoiceHologramSpin(0, 64, 1));
    expect(advanceVoiceHologramSpin(1, -20, 1)).toBe(1);
    expect(advanceVoiceHologramSpin(1, Number.NaN, 1)).toBe(1);
    // A poisoned accumulator recovers to a usable angle instead of staying NaN.
    expect(advanceVoiceHologramSpin(Number.NaN, 16, 1)).toBeCloseTo(
      advanceVoiceHologramSpin(0, 16, 1),
      12,
    );
  });

  it('paces the mark at half the display rate without drifting', () => {
    // A 60Hz display: every other callback should paint.
    expect(shouldPaintVoiceHologramFrame(null, 1_000)).toBe(true);
    expect(shouldPaintVoiceHologramFrame(1_000, 1_016.7)).toBe(false);
    expect(shouldPaintVoiceHologramFrame(1_000, 1_033.4)).toBe(true);
    // A 120Hz display still lands on ~30Hz, not 60.
    expect(shouldPaintVoiceHologramFrame(1_000, 1_008.3)).toBe(false);
    expect(shouldPaintVoiceHologramFrame(1_000, 1_024.9)).toBe(false);
    // A clock that jumps backwards (or a fresh loop) must not stall the mark.
    expect(shouldPaintVoiceHologramFrame(5_000, 1_000)).toBe(true);
  });

  it('uses live audio only in listening and speaking phases', () => {
    expect(resolveVoiceHologramEnergy('listening', 0.8)).toBeGreaterThan(0.7);
    expect(resolveVoiceHologramEnergy('speaking', 0.8)).toBeGreaterThan(0.7);
    expect(resolveVoiceHologramEnergy('working', 0.8)).toBeLessThan(0.5);
    expect(resolveVoiceHologramEnergy('paused', 0.8)).toBeLessThan(0.2);
  });

  it('caps backing resolution at two device pixels per CSS pixel', () => {
    expect(resolveVoiceCanvasSize(320, 180, 4)).toEqual({ width: 640, height: 360, dpr: 2 });
    expect(resolveVoiceCanvasSize(320, 180, 1.5)).toEqual({ width: 480, height: 270, dpr: 1.5 });
  });
});

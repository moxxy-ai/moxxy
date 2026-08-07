import { describe, expect, it } from 'vitest';
import {
  buildVoiceHologramSegments,
  buildVoiceHologramField,
  groupVoiceHologramSegments,
  orderVoiceHologramParticles,
  resolveVoiceHologramEnergy,
  resolveVoiceHologramLayout,
  resolveVoiceCanvasSize,
  sampleRoundedSquare,
} from './voice-hologram-field';

describe('voice hologram geometry', () => {
  it('builds a deterministic two-strand Moxxy mark', () => {
    const first = buildVoiceHologramField({ seed: 42, particleCount: 360 });
    const second = buildVoiceHologramField({ seed: 42, particleCount: 360 });

    expect(first).toEqual(second);
    expect(first.logo).toHaveLength(360);
    expect(new Set(first.logo.map((particle) => particle.strand))).toEqual(new Set([0, 1]));
    expect(new Set(first.logo.map((particle) => particle.filament)).size).toBeGreaterThanOrEqual(11);
    expect(first.logo.every(({ x, y }) => Math.abs(x) <= 1 && Math.abs(y) <= 1)).toBe(true);
    expect(first.orbits.length).toBeGreaterThan(20);
  });

  it('keeps the pink diamond larger while both ribbons retain the same material width', () => {
    const field = buildVoiceHologramField({ seed: 7, particleCount: 700 });
    const extent = (strand: 0 | 1): number => Math.max(
      ...field.logo
        .filter((particle) => particle.strand === strand)
        .map((particle) => Math.hypot(particle.x, particle.y)),
    );

    const ratio = extent(1) / extent(0);
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.19);
  });

  it('builds a materially wide particle ribbon rather than a single thin contour', () => {
    const field = buildVoiceHologramField({ seed: 9, particleCount: 880 });
    const firstCrossSection = field.logo
      .filter((particle) => particle.strand === 0)
      .slice(0, 11);
    const width = Math.max(...firstCrossSection.flatMap((left) => (
      firstCrossSection.map((right) => Math.hypot(left.x - right.x, left.y - right.y))
    )));

    expect(width).toBeGreaterThan(0.17);
  });

  it('keeps the holographic mark dominant in the accepted desktop stage proportions', () => {
    expect(resolveVoiceHologramLayout(900, 390)).toEqual({
      centreX: 450,
      centreY: 171.6,
      radius: 205,
    });
    expect(resolveVoiceHologramLayout(760, 360).radius).toBeGreaterThanOrEqual(190);
  });

  it('localizes the weave to four crossing zones instead of dimming whole path sections', () => {
    const field = buildVoiceHologramField({ seed: 11, particleCount: 700 });
    const crossingPoints = field.logo.filter((particle) => particle.crossing !== 'none');
    const neutralPoints = field.logo.filter((particle) => particle.crossing === 'none');

    expect(crossingPoints.length).toBeGreaterThan(0);
    expect(crossingPoints.length).toBeLessThan(field.logo.length * 0.25);
    expect(neutralPoints.length).toBeGreaterThan(field.logo.length * 0.5);
  });

  it('alternates the foreground ribbon in the four logo quadrants', () => {
    const field = buildVoiceHologramField({ seed: 17, particleCount: 700 });
    const overPasses = field.logo.filter((particle) => particle.crossing === 'over');
    const underPasses = field.logo.filter((particle) => particle.crossing === 'under');

    expect(new Set(overPasses.map((particle) => particle.strand))).toEqual(new Set([0, 1]));
    expect(new Set(underPasses.map((particle) => particle.strand))).toEqual(new Set([0, 1]));
    expect(overPasses.every((particle) => (
      particle.strand === (particle.x * particle.y >= 0 ? 1 : 0)
    ))).toBe(true);
    expect(underPasses.every((particle) => (
      particle.strand !== (particle.x * particle.y >= 0 ? 1 : 0)
    ))).toBe(true);
  });

  it('renders under passes first, neutral ribbons next, and over passes last', () => {
    const field = buildVoiceHologramField({ seed: 19, particleCount: 700 });
    const ordered = orderVoiceHologramParticles(field.logo);
    const ranks = ordered.map((particle) => ({ under: 0, none: 1, over: 2 })[particle.crossing]);

    expect(ranks).toContain(0);
    expect(ranks).toContain(1);
    expect(ranks).toContain(2);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });

  it('keeps the locally occluded ribbon bright enough to remain continuous', () => {
    const field = buildVoiceHologramField({ seed: 23, particleCount: 700 });
    const underPasses = field.logo.filter((particle) => particle.crossing === 'under');

    expect(underPasses.length).toBeGreaterThan(0);
    expect(Math.min(...underPasses.map((particle) => particle.weave))).toBeGreaterThanOrEqual(0.7);
  });

  it('builds closed stroke segments that preserve local depth layers', () => {
    const field = buildVoiceHologramField({ seed: 29, particleCount: 700 });
    const centreLine = field.logo.filter((particle) => (
      particle.strand === 0 && particle.filament === 4
    ));
    const segments = buildVoiceHologramSegments(centreLine);

    expect(segments).toHaveLength(centreLine.length);
    expect(new Set(segments.map((segment) => segment.crossing))).toEqual(
      new Set(['under', 'none', 'over']),
    );
    expect(segments.filter((segment) => segment.crossing === 'over').length)
      .toBeLessThan(segments.length * 0.4);
    expect(segments.at(-1)?.end).toBe(centreLine[0]);
  });

  it('joins adjacent crossing segments into continuous ribbon strokes', () => {
    const field = buildVoiceHologramField({ seed: 31, particleCount: 880 });
    const centreLine = field.logo.filter((particle) => (
      particle.strand === 1 && particle.filament === 5
    ));
    const segments = buildVoiceHologramSegments(centreLine);
    const overSegments = segments.filter((segment) => segment.crossing === 'over');
    const groups = groupVoiceHologramSegments(segments, 'over');

    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThan(overSegments.length);
    expect(groups.flat()).toEqual(overSegments);
    expect(groups.every((group) => group.every((segment, index) => (
      index === 0 || group[index - 1]?.end === segment.start
    )))).toBe(true);
  });

  it('samples a closed rounded square without introducing a seam', () => {
    const points = sampleRoundedSquare({ count: 96, rotation: Math.PI / 4 });
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) throw new Error('Rounded-square sample must contain boundary points');
    expect(points).toHaveLength(96);
    expect(Math.hypot(first.x - last.x, first.y - last.y))
      .toBeLessThan(0.12);
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

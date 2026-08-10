/**
 * The hologram, baked.
 *
 * The mark is a RIGID body: it only turns. Repainting its ribbons, mesh, grain
 * and bloom every frame cost ~86ms of rasterisation at 2400×820 — `shadowBlur`
 * alone was ~45ms of that, because a canvas shadow blurs the drawn geometry on
 * every single stroke. So the expensive, invariant parts are painted ONCE into
 * offscreen canvases here, and the animation composites them with a rotation.
 *
 * Everything that genuinely varies per frame stays in the animation hook: the
 * turn, the audio energy (a scale and an alpha over the sprite), the drifting
 * dust and the tool tethers.
 */

import {
  resolveHologramCrossings,
  VOICE_HOLOGRAM_MARK,
  type HologramStrand,
  type VoiceHologramField,
} from './voice-hologram-field';

export type Rgb = readonly [number, number, number];

export interface HologramPalette {
  readonly lightTheme: boolean;
  readonly background: Rgb;
  readonly voidTone: Rgb;
  readonly accent: Rgb;
  readonly strandColor: readonly [Rgb, Rgb];
  readonly strandCore: readonly [Rgb, Rgb];
  /** Additive on ink, plain paint on paper — adding light to white is a no-op. */
  readonly blend: GlobalCompositeOperation;
  readonly glowScale: number;
  readonly traceScale: number;
}

/** Half-width of the mark sprite, in mark radii — leaves room for the bloom. */
export const MARK_SPRITE_SPAN = 1.24;
/** Flare sprite half-width, in mark radii. */
export const FLARE_SPRITE_SPAN = 0.4;
/** Energy the sprites are baked at; the hook modulates around it. */
export const SPRITE_NOMINAL_ENERGY = 0.3;

/** Where the lattice's longitudinal filaments sit across the ribbon width. */
const FILAMENTS: ReadonlyArray<number> = [-0.82, -0.6, -0.38, -0.16, 0.06, 0.28, 0.5, 0.72];
/** Samples between two transverse lattice ticks — chosen so the mesh cells come
 *  out roughly square against {@link FILAMENTS}' spacing across the ribbon. */
const TICK_STRIDE = 3;
const TAU = Math.PI * 2;
/** Under `destination-out` a stroke reads only its ALPHA, so this is an eraser
 *  rather than a colour choice — the palette has no say in it, and the
 *  palette guard test exempts this one name for that reason. */
const ERASER_ALPHA_ONLY = '#000';

export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

export function rgba(color: Rgb, alpha: number): string {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`;
}

function createSurface(sizePx: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sizePx));
  canvas.height = Math.max(1, Math.round(sizePx));
  const context = canvas.getContext('2d');
  return context ? { canvas, context } : null;
}

/**
 * Paint the woven mark, unrotated, centred in its own surface.
 *
 * The weave is the shipped mark's construction: ink strand, accent strand over
 * it, ink strand restored inside four circular windows. Each pass first ERASES
 * its own ribbon (`destination-out`) rather than stroking the backdrop colour
 * over it, so the sprite stays transparent and composites onto any field.
 */
export function buildMarkSprite({
  field,
  radius,
  dpr,
  palette,
}: {
  readonly field: VoiceHologramField;
  readonly radius: number;
  readonly dpr: number;
  readonly palette: HologramPalette;
}): HTMLCanvasElement | null {
  const mark = VOICE_HOLOGRAM_MARK;
  const span = radius * MARK_SPRITE_SPAN;
  const surface = createSurface(span * 2 * dpr);
  if (!surface) return null;
  const { canvas, context } = surface;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const centre = span;
  const energy = SPRITE_NOMINAL_ENERGY;
  const half = mark.half * radius;
  const band = mark.band * radius;
  const corner = mark.corner * radius;
  const { blend, glowScale, traceScale, strandColor, strandCore, lightTheme } = palette;

  const trace = (halfSide: number, cornerRadius: number, spin: number): void => {
    context.save();
    context.translate(centre, centre);
    context.rotate(spin);
    context.beginPath();
    context.roundRect(
      -halfSide,
      -halfSide,
      halfSide * 2,
      halfSide * 2,
      Math.max(0, Math.min(halfSide, cornerRadius)),
    );
    context.restore();
  };

  const paintStrand = (strand: HologramStrand): void => {
    const spin = strand === 1 ? Math.PI / 4 : 0;
    const color = strandColor[strand];
    const core = strandCore[strand];
    const samples = field.samples[strand];
    // The accent only lights the red channel, so at equal alpha its mesh reads
    // dimmer than the ink strand's; lift it back to parity.
    const heat = strand === 1 ? 1.28 : 1;

    // Carve this ribbon (plus a hairline seam) out of everything already in the
    // sprite, so the strand genuinely passes IN FRONT of the one beneath.
    context.globalCompositeOperation = 'destination-out';
    context.setLineDash([]);
    context.lineJoin = 'round';
    context.strokeStyle = ERASER_ALPHA_ONLY;
    context.lineWidth = band * 2 + radius * 0.024;
    trace(half, corner, spin);
    context.stroke();

    context.globalCompositeOperation = blend;

    // Ribbon interior: a wash, longitudinal filaments and transverse ticks —
    // the mesh that makes the light read as material rather than a line.
    context.strokeStyle = rgba(color, (0.05 + energy * 0.04) * traceScale);
    context.lineWidth = band * 2;
    trace(half, corner, spin);
    context.stroke();

    context.lineWidth = 0.55;
    context.strokeStyle = rgba(color, (0.16 + energy * 0.09) * heat * traceScale);
    for (const filament of FILAMENTS) {
      trace(half + band * filament, corner + band * filament, spin);
      context.stroke();
    }

    context.beginPath();
    for (let index = 0; index < samples.length; index += TICK_STRIDE) {
      const sample = samples[index];
      if (!sample) continue;
      context.moveTo(
        centre + (sample.x - sample.nx * mark.band) * radius,
        centre + (sample.y - sample.ny * mark.band) * radius,
      );
      context.lineTo(
        centre + (sample.x + sample.nx * mark.band) * radius,
        centre + (sample.y + sample.ny * mark.band) * radius,
      );
    }
    context.strokeStyle = rgba(color, (0.13 + energy * 0.08) * heat * traceScale);
    context.stroke();

    // Neon contours. The bloom is a canvas shadow, which is ruinous per frame
    // but free here: this runs once per size and theme, not sixty times a
    // second, and a shadow falls off smoothly where stepped strokes band.
    for (const edge of [1, -1] as const) {
      const emphasis = edge === 1 ? 1 : 0.82;
      if (glowScale > 0) {
        context.shadowColor = rgba(color, 0.85);
        context.shadowBlur = radius * (0.09 + energy * 0.05) * emphasis;
      }
      context.strokeStyle = rgba(color, (0.5 + energy * 0.25) * emphasis * traceScale);
      context.lineWidth = 2.2;
      trace(half + band * edge, corner + band * edge, spin);
      context.stroke();
      if (glowScale > 0) context.shadowBlur = radius * 0.03;
      context.strokeStyle = rgba(core, 0.9 * emphasis * (lightTheme ? 0.75 : 1));
      context.lineWidth = 0.9;
      trace(half + band * edge, corner + band * edge, spin);
      context.stroke();
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
    }

    // Holographic grain. Baked, so the per-mote twinkle is gone; the turn, the
    // energy breath and the drifting dust carry the life instead.
    for (const particle of field.particles) {
      if (particle.strand !== strand) continue;
      const sample = samples[particle.index];
      if (!sample) continue;
      const across = mark.band * particle.offset;
      const x = centre + (sample.x + sample.nx * across) * radius;
      const y = centre + (sample.y + sample.ny * across) * radius;
      const alpha = particle.brightness * 0.72 * heat * traceScale;
      const size = particle.size * 1.05;
      if (glowScale > 0) {
        context.fillStyle = rgba(color, alpha * 0.2);
        context.fillRect(x - size * 1.4, y - size * 1.4, size * 2.8, size * 2.8);
      }
      context.fillStyle = rgba(particle.brightness > 0.86 ? core : color, alpha);
      context.fillRect(x - size / 2, y - size / 2, size, size);
    }
  };

  paintStrand(0);
  paintStrand(1);

  // Restore the ink strand inside the four windows the mark weaves through.
  context.save();
  context.beginPath();
  for (const crossing of resolveHologramCrossings()) {
    if (crossing.over !== 0) continue;
    const x = centre + crossing.x * radius;
    const y = centre + crossing.y * radius;
    context.moveTo(x + mark.weave * radius, y);
    context.arc(x, y, mark.weave * radius, 0, TAU);
  }
  context.clip();
  paintStrand(0);
  context.restore();

  context.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * One crossing flare: a bloom and a four-ray star, centred in its own surface.
 * Baked because eight of them meant forty freshly-allocated gradients a frame.
 */
export function buildFlareSprite({
  radius,
  dpr,
  color,
  core,
  lightTheme,
}: {
  readonly radius: number;
  readonly dpr: number;
  readonly color: Rgb;
  readonly core: Rgb;
  readonly lightTheme: boolean;
}): HTMLCanvasElement | null {
  const span = radius * FLARE_SPRITE_SPAN;
  const surface = createSurface(span * 2 * dpr);
  if (!surface) return null;
  const { canvas, context } = surface;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const centre = span;
  const scale = radius * (0.24 + SPRITE_NOMINAL_ENERGY * 0.06);
  const strength = lightTheme ? 0.5 : 1;

  context.globalCompositeOperation = lightTheme ? 'source-over' : 'lighter';
  if (!lightTheme) {
    const bloom = context.createRadialGradient(centre, centre, 0, centre, centre, scale);
    bloom.addColorStop(0, rgba(core, 0.62));
    bloom.addColorStop(0.14, rgba(core, 0.26));
    bloom.addColorStop(0.38, rgba(color, 0.1));
    bloom.addColorStop(1, rgba(color, 0));
    context.fillStyle = bloom;
    context.fillRect(centre - scale, centre - scale, scale * 2, scale * 2);
  }
  for (const ray of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    const long = ray === 0 || ray === Math.PI / 2;
    const reach = scale * (long ? 1.5 : 0.62) * (lightTheme ? 0.34 : 1);
    const dx = Math.cos(ray) * reach;
    const dy = Math.sin(ray) * reach;
    const streak = context.createLinearGradient(centre - dx, centre - dy, centre + dx, centre + dy);
    streak.addColorStop(0, rgba(color, 0));
    streak.addColorStop(0.5, rgba(core, (long ? 0.5 : 0.28) * strength));
    streak.addColorStop(1, rgba(color, 0));
    context.strokeStyle = streak;
    context.lineWidth = long ? 1.5 : 1;
    context.beginPath();
    context.moveTo(centre - dx, centre - dy);
    context.lineTo(centre + dx, centre + dy);
    context.stroke();
  }
  context.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * Resolution the backdrop is baked at, relative to the device pixel grid.
 *
 * It is two smooth radial gradients and nothing else, so it survives being
 * stretched from a quarter of the pixels with no visible difference — and that
 * matters: on a wide display the full-resolution version is tens of megabytes
 * of canvas held for as long as Voice Mode is open. The dotted rings do NOT
 * live here for the same reason; hairlines are the one thing that would show.
 */
export const BACKDROP_SCALE = 0.5;

/**
 * The field the mark floats in: the deep centre handing back to the app's
 * surface colour at the canvas edges, plus the accent wash. Static for a given
 * size and theme, and it covered the entire canvas twice a frame in gradient
 * fills — now it is one blit of a quarter-sized texture.
 */
export function buildBackdropSprite({
  width,
  height,
  centreX,
  centreY,
  radius,
  dpr,
  palette,
}: {
  readonly width: number;
  readonly height: number;
  readonly centreX: number;
  readonly centreY: number;
  readonly radius: number;
  readonly dpr: number;
  readonly palette: HologramPalette;
}): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  const scale = dpr * BACKDROP_SCALE;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const energy = SPRITE_NOMINAL_ENERGY;

  const shell = context.createRadialGradient(
    centreX,
    centreY,
    radius * 1.15,
    centreX,
    centreY,
    Math.hypot(width, height) * 0.5,
  );
  shell.addColorStop(0, rgba(palette.voidTone, 1));
  shell.addColorStop(1, rgba(palette.background, 1));
  context.fillStyle = shell;
  context.fillRect(0, 0, width, height);

  const wash = context.createRadialGradient(centreX, centreY, 0, centreX, centreY, radius * 2.1);
  wash.addColorStop(0, rgba(palette.accent, palette.lightTheme ? 0.03 : 0.055 + energy * 0.05));
  wash.addColorStop(0.42, rgba(palette.accent, palette.lightTheme ? 0.015 : 0.02));
  wash.addColorStop(1, rgba(palette.accent, 0));
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);
  return canvas;
}

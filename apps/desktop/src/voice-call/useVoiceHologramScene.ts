import { useEffect, useRef, type RefObject } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import {
  buildVoiceHologramField,
  resolveHologramCrossings,
  resolveVoiceCanvasSize,
  resolveVoiceHologramLayout,
} from './voice-hologram-field';
import {
  buildBackdropSprite,
  buildFlareSprite,
  buildMarkSprite,
  mix,
  rgba,
  FLARE_SPRITE_SPAN,
  MARK_SPRITE_SPAN,
  SPRITE_NOMINAL_ENERGY,
  type HologramPalette,
  type Rgb,
} from './voice-hologram-sprites';

const FALLBACK_PRIMARY: Rgb = [244, 64, 143];
const FALLBACK_INK: Rgb = [228, 235, 239];
const WHITE: Rgb = [255, 255, 255];
const VOID: Rgb = [3, 4, 8];

function parseColor(value: string, fallback: Rgb): Rgb {
  const hex = value.trim().replace('#', '');
  if (/^[0-9a-f]{6}$/iu.test(hex)) {
    const number = Number.parseInt(hex, 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  }
  const match = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/iu);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : fallback;
}

function isLight(color: Rgb): boolean {
  return color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114 > 140;
}

function resolvePalette(ink: Rgb, accent: Rgb, background: Rgb): HologramPalette {
  const lightTheme = isLight(background);
  return {
    lightTheme,
    background,
    accent,
    voidTone: lightTheme ? background : mix(background, VOID, 0.72),
    strandColor: lightTheme
      ? [mix(ink, background, 0.12), accent]
      : [mix(ink, [186, 214, 255], 0.34), mix(accent, [255, 26, 96], 0.35)],
    strandCore: lightTheme ? [ink, mix(accent, VOID, 0.25)] : [WHITE, mix(accent, WHITE, 0.66)],
    blend: lightTheme ? 'source-over' : 'lighter',
    glowScale: lightTheme ? 0 : 1,
    traceScale: lightTheme ? 2.1 : 1,
  };
}

/**
 * Paints the Moxxy mark as a woven light sculpture — ONCE.
 *
 * The mark sits in the same orientation as the app's own logo and does not
 * move, so there is nothing to redraw between frames: the scene is repainted
 * only when the stage resizes, the theme changes, the call fails, or the set of
 * running operations changes. What breathes with the voice is a CSS pulse over
 * the top (see useVoicePulse), which the compositor animates without ever
 * asking this canvas for another frame.
 *
 * The measurement that led here: an animated version of this canvas cost ~10
 * points of a 120Hz machine's GPU, continuously, for as long as Voice Mode was
 * open — next to 1.2% for the whole chat surface.
 */
export function useVoiceHologramScene({
  phase,
  occupiedSlots,
}: {
  readonly phase: VoiceCallPhase;
  readonly occupiedSlots: ReadonlyArray<number>;
}): RefObject<HTMLCanvasElement> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The caller hands us a freshly mapped array on every render, so the effect
  // keys off its CONTENT and reads the array through a ref. Depending on the
  // array itself re-ran the effect on every render of the surface — and during
  // a streaming turn that is every delta, each one rebuilding the 2,600-particle
  // field and repainting the canvas, shadow bloom and all.
  const slots = occupiedSlots.join(',');
  const slotsRef = useRef(occupiedSlots);
  slotsRef.current = occupiedSlots;
  const fieldRef = useRef<ReturnType<typeof buildVoiceHologramField> | null>(null);
  fieldRef.current ??= buildVoiceHologramField();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const field = fieldRef.current ?? buildVoiceHologramField();
    const crossings = resolveHologramCrossings();
    let disposed = false;

    const paint = (): void => {
      if (disposed) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;
      const resolution = resolveVoiceCanvasSize(width, height, window.devicePixelRatio || 1);
      if (canvas.width !== resolution.width || canvas.height !== resolution.height) {
        canvas.width = resolution.width;
        canvas.height = resolution.height;
      }
      const dpr = resolution.dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const style = getComputedStyle(canvas);
      const primary = parseColor(style.getPropertyValue('--color-primary'), FALLBACK_PRIMARY);
      const ink = parseColor(style.getPropertyValue('--color-text'), FALLBACK_INK);
      const failure = parseColor(style.getPropertyValue('--color-red'), [242, 84, 91]);
      const background = parseColor(style.getPropertyValue('--color-main-bg'), [16, 21, 25]);
      const accent = phase === 'error' ? failure : primary;
      const palette = resolvePalette(ink, accent, background);

      const layout = resolveVoiceHologramLayout(width, height);
      const { centreX, centreY, radius } = layout;
      const energy = SPRITE_NOMINAL_ENERGY;

      context.globalCompositeOperation = 'source-over';
      const backdrop = buildBackdropSprite({
        width, height, centreX, centreY, radius, dpr, palette,
      });
      if (backdrop) context.drawImage(backdrop, 0, 0, width, height);

      context.globalCompositeOperation = palette.blend;
      context.lineWidth = 1;
      for (const ring of field.rings) {
        context.beginPath();
        context.arc(centreX, centreY, radius * ring.radius, 0, Math.PI * 2);
        context.strokeStyle = rgba(
          ring.radius > 1.4 ? palette.strandColor[1] : palette.strandColor[0],
          ring.alpha * (2 + energy) * palette.traceScale,
        );
        context.setLineDash([ring.dash[0], ring.dash[1]]);
        context.stroke();
      }
      context.setLineDash([]);
      for (const mote of field.dust) {
        context.fillStyle = rgba(
          palette.strandColor[mote.tint],
          mote.brightness * 0.78 * (0.46 + energy * 0.4) * palette.traceScale,
        );
        context.fillRect(
          centreX + Math.cos(mote.angle) * radius * mote.radius,
          centreY + Math.sin(mote.angle) * radius * mote.radius,
          mote.size,
          mote.size,
        );
      }

      const mark = buildMarkSprite({ field, radius, dpr, palette });
      if (mark) {
        const span = radius * MARK_SPRITE_SPAN;
        context.drawImage(mark, centreX - span, centreY - span, span * 2, span * 2);
      }

      const flares = ([0, 1] as const).map((strand) => buildFlareSprite({
        radius,
        dpr,
        color: palette.strandColor[strand],
        core: palette.strandCore[strand],
        lightTheme: palette.lightTheme,
      }));
      const flareSpan = radius * FLARE_SPRITE_SPAN;
      for (const crossing of crossings) {
        const sprite = flares[crossing.over];
        if (!sprite) continue;
        const x = centreX + crossing.x * radius;
        const y = centreY + crossing.y * radius;
        context.drawImage(sprite, x - flareSpan, y - flareSpan, flareSpan * 2, flareSpan * 2);
      }

      const endpoints = [
        { x: width * 0.17, y: height * 0.28 },
        { x: width * 0.83, y: height * 0.3 },
        { x: width * 0.82, y: height * 0.72 },
      ] as const;
      const activeSlots = slotsRef.current;
      if (activeSlots.length > 0) {
        context.setLineDash([2, 7]);
        context.lineWidth = 1;
        context.strokeStyle = rgba(accent, (0.34 + energy * 0.22) * palette.traceScale);
        for (const slot of activeSlots) {
          const endpoint = endpoints[slot];
          if (!endpoint) continue;
          const direction = endpoint.x < centreX ? -1 : 1;
          context.beginPath();
          context.moveTo(centreX + direction * radius * 0.9, centreY + (endpoint.y - centreY) * 0.18);
          context.bezierCurveTo(
            centreX + direction * radius * 1.25,
            endpoint.y,
            endpoint.x - direction * 34,
            endpoint.y,
            endpoint.x,
            endpoint.y,
          );
          context.stroke();
        }
        context.setLineDash([]);
      }
      context.globalCompositeOperation = 'source-over';
    };

    paint();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => paint()) : null;
    observer?.observe(canvas);
    const themeObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => paint())
      : null;
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      themeObserver?.disconnect();
    };
  }, [phase, slots]);

  return canvasRef;
}

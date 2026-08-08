import { useEffect, useRef, type RefObject } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { useReducedMotion } from '../shell/useReducedMotion';
import {
  advanceVoiceHologramSpin,
  buildVoiceHologramField,
  resolveHologramCrossings,
  resolveVoiceCanvasSize,
  resolveVoiceHologramEnergy,
  resolveVoiceHologramLayout,
  resolveVoiceHologramSpeed,
  shouldPaintVoiceHologramFrame,
} from './voice-hologram-field';
import { createAnalyserLevelBuffers, readAnalyserLevel } from './voice-analyser-level';
import {
  buildBackdropSprite,
  buildFlareSprite,
  buildMarkSprite,
  mix,
  resolveSpriteCacheKey,
  resolveSpriteSize,
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

/** Dust alpha is quantised onto this many steps so the per-frame loop reuses a
 *  small table of colour strings instead of allocating one per mote. */
const DUST_ALPHA_STEPS = 12;

function parseColor(value: string, fallback: Rgb): Rgb {
  const hex = value.trim().replace('#', '');
  if (/^[0-9a-f]{6}$/iu.test(hex)) {
    const number = Number.parseInt(hex, 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  }
  const match = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/iu);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : fallback;
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
    strandCore: lightTheme
      ? [ink, mix(accent, VOID, 0.25)]
      : [WHITE, mix(accent, WHITE, 0.66)],
    blend: lightTheme ? 'source-over' : 'lighter',
    glowScale: lightTheme ? 0 : 1,
    traceScale: lightTheme ? 2.1 : 1,
  };
}

/**
 * Animates the Moxxy mark as a woven light sculpture: two rounded-square
 * ribbons of holographic particles, each edged by a neon contour, crossing
 * through one another at eight flared nodes inside a field of drifting dust.
 *
 * The mark is a rigid body — it only turns — so the expensive, invariant parts
 * are baked into offscreen sprites (see voice-hologram-sprites) and this loop
 * only composites them. Repainting them live cost ~86ms of rasterisation per
 * frame at 2400×820, which is roughly five frames' worth of budget for one
 * frame's work; a Voice Mode window is open next to live audio playback, so
 * that is a cost the whole app pays.
 */
export function useVoiceHologramAnimation({
  phase,
  inputAnalyser,
  outputAnalyser,
  occupiedSlots,
}: {
  readonly phase: VoiceCallPhase;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly occupiedSlots: ReadonlyArray<number>;
}): RefObject<HTMLCanvasElement> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);
  const reducedMotion = useReducedMotion();
  const phaseRef = useRef(phase);
  const inputRef = useRef(inputAnalyser);
  const outputRef = useRef(outputAnalyser);
  const slotsRef = useRef(occupiedSlots);
  phaseRef.current = phase;
  inputRef.current = inputAnalyser;
  outputRef.current = outputAnalyser;
  slotsRef.current = occupiedSlots;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const field = buildVoiceHologramField();
    const crossings = resolveHologramCrossings();
    const buffers = createAnalyserLevelBuffers();
    let frame = 0;
    let cancelled = false;
    let visible = document.visibilityState !== 'hidden';
    let smoothed = 0;
    let turn = 0;
    let lastFrame: number | null = null;
    let lastPaint: number | null = null;

    let primary = FALLBACK_PRIMARY;
    let ink = FALLBACK_INK;
    let failure: Rgb = [242, 84, 91];
    let background: Rgb = [16, 21, 25];
    const readThemeColors = (): void => {
      const style = getComputedStyle(canvas);
      primary = parseColor(style.getPropertyValue('--color-primary'), FALLBACK_PRIMARY);
      ink = parseColor(style.getPropertyValue('--color-text'), FALLBACK_INK);
      failure = parseColor(style.getPropertyValue('--color-red'), [242, 84, 91]);
      background = parseColor(style.getPropertyValue('--color-main-bg'), [16, 21, 25]);
    };
    readThemeColors();

    // ---- sprite cache ----------------------------------------------------
    let cacheKey = '';
    let palette = resolvePalette(ink, primary, background);
    let markSprite: HTMLCanvasElement | null = null;
    let flareSprites: readonly [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
    let backdropSprite: HTMLCanvasElement | null = null;
    let dustColors: ReadonlyArray<ReadonlyArray<string>> = [[], []];

    // Sprites are baked at the QUANTISED stage size, then scaled to the live
    // one at composite time, so a window drag does not rebuild them per pixel.
    const rebuildSprites = (width: number, height: number, dpr: number, accent: Rgb): void => {
      const size = resolveSpriteSize(width, height);
      const layout = resolveVoiceHologramLayout(size.width, size.height);
      const radius = layout.radius;
      palette = resolvePalette(ink, accent, background);
      markSprite = buildMarkSprite({ field, radius, dpr, palette });
      flareSprites = [
        buildFlareSprite({
          radius,
          dpr,
          color: palette.strandColor[0],
          core: palette.strandCore[0],
          lightTheme: palette.lightTheme,
        }),
        buildFlareSprite({
          radius,
          dpr,
          color: palette.strandColor[1],
          core: palette.strandCore[1],
          lightTheme: palette.lightTheme,
        }),
      ];
      backdropSprite = buildBackdropSprite({
        width: size.width,
        height: size.height,
        centreX: layout.centreX,
        centreY: layout.centreY,
        radius,
        dpr,
        palette,
      });
      dustColors = palette.strandColor.map((color) => (
        Array.from({ length: DUST_ALPHA_STEPS + 1 }, (_, step) => rgba(color, step / DUST_ALPHA_STEPS))
      ));
    };

    const readLevel = (): number => readAnalyserLevel(
      phaseRef.current === 'speaking'
        ? outputRef.current
        : phaseRef.current === 'listening'
          ? inputRef.current
          : null,
      buffers,
    );

    const draw = (timestamp: number): void => {
      if (cancelled) return;
      const schedule = (): void => {
        if (!reducedMotion && visible) frame = requestAnimationFrame(draw);
      };
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) {
        schedule();
        return;
      }
      // The mark turns slowly enough that half the display's frames carry it
      // perfectly well, and the other half are pure heat.
      if (!reducedMotion && !shouldPaintVoiceHologramFrame(lastPaint, timestamp)) {
        schedule();
        return;
      }

      const resolution = resolveVoiceCanvasSize(width, height, window.devicePixelRatio || 1);
      if (canvas.width !== resolution.width || canvas.height !== resolution.height) {
        canvas.width = resolution.width;
        canvas.height = resolution.height;
      }
      context.setTransform(resolution.dpr, 0, 0, resolution.dpr, 0, 0);

      const accent = phaseRef.current === 'error' ? failure : primary;
      const layout = resolveVoiceHologramLayout(width, height);
      const nextKey = resolveSpriteCacheKey({
        width, height, dpr: resolution.dpr, ink, accent, background,
      });
      if (nextKey !== cacheKey) {
        cacheKey = nextKey;
        rebuildSprites(width, height, resolution.dpr, accent);
      }

      const live = reducedMotion ? 0 : readLevel();
      smoothed += (resolveVoiceHologramEnergy(phaseRef.current, live) - smoothed) * 0.14;
      const energy = smoothed;
      const speed = resolveVoiceHologramSpeed(phaseRef.current);
      const clock = reducedMotion ? 2_400 : timestamp;
      const elapsed = lastFrame === null ? 0 : timestamp - lastFrame;
      lastFrame = timestamp;
      lastPaint = timestamp;
      // One continuous clockwise turn. The mark is symmetric under a quarter
      // turn, so the rotation reads as an endless loop with no seam to hide.
      if (!reducedMotion) turn = advanceVoiceHologramSpin(turn, elapsed, speed);

      const centreX = layout.centreX;
      const centreY = layout.centreY;
      const radius = layout.radius;
      const breath = 1 + energy * 0.04;

      // ---- backdrop --------------------------------------------------------
      context.globalCompositeOperation = 'source-over';
      context.globalAlpha = 1;
      if (backdropSprite) context.drawImage(backdropSprite, 0, 0, width, height);
      else context.clearRect(0, 0, width, height);

      // ---- dust field ------------------------------------------------------
      // The rings are hairlines, so they are drawn live rather than baked into
      // the quarter-resolution backdrop where they would smear.
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
        const angle = mote.angle + (clock / 1_000) * mote.drift * speed;
        const twinkle = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(clock / 900 + mote.angle * 7);
        const alpha = mote.brightness * twinkle * (0.46 + energy * 0.4) * palette.traceScale;
        const step = Math.max(0, Math.min(DUST_ALPHA_STEPS, Math.round(alpha * DUST_ALPHA_STEPS)));
        if (step === 0) continue;
        const table = dustColors[mote.tint];
        if (!table) continue;
        context.fillStyle = table[step] ?? '';
        context.fillRect(
          centreX + Math.cos(angle) * radius * mote.radius,
          centreY + Math.sin(angle) * radius * mote.radius,
          mote.size,
          mote.size,
        );
      }

      // ---- the woven mark ---------------------------------------------------
      if (markSprite) {
        const span = radius * MARK_SPRITE_SPAN;
        context.save();
        context.globalAlpha = Math.min(1, 0.82 + energy * 0.28);
        context.translate(centreX, centreY);
        context.rotate(turn);
        context.scale(breath, breath);
        context.drawImage(markSprite, -span, -span, span * 2, span * 2);
        context.restore();
      }

      // ---- crossing flares --------------------------------------------------
      const flarePulse = reducedMotion ? 1 : 0.86 + 0.14 * Math.sin(clock / 700);
      const flareSpan = radius * FLARE_SPRITE_SPAN
        * (0.24 + energy * 0.06) / (0.24 + SPRITE_NOMINAL_ENERGY * 0.06)
        * flarePulse * breath;
      for (const crossing of crossings) {
        const sprite = flareSprites[crossing.over];
        if (!sprite) continue;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const x = centreX + (crossing.x * cos - crossing.y * sin) * radius * breath;
        const y = centreY + (crossing.x * sin + crossing.y * cos) * radius * breath;
        context.save();
        context.translate(x, y);
        context.rotate(turn);
        context.drawImage(sprite, -flareSpan, -flareSpan, flareSpan * 2, flareSpan * 2);
        context.restore();
      }

      // ---- tool tethers ------------------------------------------------------
      context.globalAlpha = 1;
      const endpoints = [
        { x: width * 0.17, y: height * 0.28 },
        { x: width * 0.83, y: height * 0.3 },
        { x: width * 0.82, y: height * 0.72 },
      ] as const;
      if (slotsRef.current.length > 0) {
        context.setLineDash([2, 7]);
        context.lineWidth = 1;
        context.strokeStyle = rgba(accent, (0.34 + energy * 0.22) * palette.traceScale);
        for (const slot of slotsRef.current) {
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

      schedule();
    };

    const redraw = (): void => {
      if (cancelled) return;
      cancelAnimationFrame(frame);
      lastPaint = null;
      draw(performance.now());
    };
    redrawRef.current = redraw;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : null;
    observer?.observe(canvas);
    const themeObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          readThemeColors();
          cacheKey = '';
          if (reducedMotion) redraw();
        })
      : null;
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const onVisibility = (): void => {
      visible = document.visibilityState !== 'hidden';
      if (visible) redraw();
      else cancelAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', onVisibility);
    redraw();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      themeObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (redrawRef.current === redraw) redrawRef.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) redrawRef.current?.();
  }, [occupiedSlots, phase, reducedMotion]);

  return canvasRef;
}

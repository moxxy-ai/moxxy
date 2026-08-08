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
  VOICE_HOLOGRAM_MARK,
} from './voice-hologram-field';
import type { HologramStrand } from './voice-hologram-field';

interface FrequencyAnalyser {
  readonly frequencyBinCount: number;
  getByteFrequencyData(target: Uint8Array): void;
}

interface TimeDomainAnalyser {
  readonly fftSize: number;
  getFloatTimeDomainData(target: Float32Array): void;
}

type Analyser =
  | { readonly kind: 'frequency'; readonly value: FrequencyAnalyser }
  | { readonly kind: 'time'; readonly value: TimeDomainAnalyser };

type Rgb = readonly [number, number, number];
const FALLBACK_PRIMARY: Rgb = [244, 64, 143];
const FALLBACK_INK: Rgb = [228, 235, 239];
const WHITE: Rgb = [255, 255, 255];
const VOID: Rgb = [3, 4, 8];
const TAU = Math.PI * 2;

/** Where the lattice's longitudinal filaments sit across the ribbon width. */
const FILAMENTS: ReadonlyArray<number> = [-0.82, -0.6, -0.38, -0.16, 0.06, 0.28, 0.5, 0.72];
/** Samples between two transverse lattice ticks — chosen so the mesh cells come
 *  out roughly square against {@link FILAMENTS}' spacing across the ribbon. */
const TICK_STRIDE = 3;

function asAnalyser(value: unknown): Analyser | null {
  if (typeof value !== 'object' || value === null) return null;
  const frequency = value as Partial<FrequencyAnalyser>;
  if (typeof frequency.frequencyBinCount === 'number' && typeof frequency.getByteFrequencyData === 'function') {
    return { kind: 'frequency', value: frequency as FrequencyAnalyser };
  }
  const time = value as Partial<TimeDomainAnalyser>;
  if (typeof time.fftSize === 'number' && typeof time.getFloatTimeDomainData === 'function') {
    return { kind: 'time', value: time as TimeDomainAnalyser };
  }
  return null;
}

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

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`;
}

function isLight(color: Rgb): boolean {
  return color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114 > 140;
}

function phaseSpeed(phase: VoiceCallPhase): number {
  if (phase === 'working' || phase === 'thinking' || phase === 'synthesizing') return 1.5;
  if (phase === 'speaking') return 1.25;
  if (phase === 'paused' || phase === 'error') return 0.35;
  return 0.75;
}

/**
 * Paints the Moxxy mark as a woven light sculpture: two rounded-square ribbons
 * of holographic particles, each edged by a neon contour, crossing through one
 * another at eight flared nodes inside a field of drifting dust.
 *
 * The weave is the same construction the shipped SVG mark uses — draw the ink
 * strand, draw the accent strand over it, then restore the ink strand inside
 * four circular windows. Each pass first CARVES its own ribbon out of what is
 * already on the canvas (an opaque stroke in the backdrop colour) so the
 * crossings read as real occlusion rather than two additive glows summing to
 * white.
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
    const mark = VOICE_HOLOGRAM_MARK;
    const strandParticles = [
      field.particles.filter((particle) => particle.strand === 0),
      field.particles.filter((particle) => particle.strand === 1),
    ] as const;
    let frame = 0;
    let cancelled = false;
    let visible = document.visibilityState !== 'hidden';
    let smoothed = 0;
    let turn = 0;
    let lastFrame: number | null = null;
    let frequencyBuffer = new Uint8Array(64);
    let timeBuffer = new Float32Array(256);
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

    const readLevel = (): number => {
      const current = phaseRef.current === 'speaking'
        ? outputRef.current
        : phaseRef.current === 'listening'
          ? inputRef.current
          : null;
      const analyser = asAnalyser(current);
      if (!analyser) return 0;
      if (analyser.kind === 'frequency') {
        if (frequencyBuffer.length !== analyser.value.frequencyBinCount) {
          frequencyBuffer = new Uint8Array(analyser.value.frequencyBinCount);
        }
        analyser.value.getByteFrequencyData(frequencyBuffer);
        let total = 0;
        for (const sample of frequencyBuffer) total += sample;
        return Math.min(1, total / Math.max(1, frequencyBuffer.length) / 180);
      }
      if (timeBuffer.length !== analyser.value.fftSize) {
        timeBuffer = new Float32Array(analyser.value.fftSize);
      }
      analyser.value.getFloatTimeDomainData(timeBuffer);
      let squares = 0;
      for (const sample of timeBuffer) squares += sample * sample;
      return Math.min(1, Math.sqrt(squares / Math.max(1, timeBuffer.length)) * 6);
    };

    const draw = (timestamp: number): void => {
      if (cancelled) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) {
        if (!reducedMotion && visible) frame = requestAnimationFrame(draw);
        return;
      }
      const resolution = resolveVoiceCanvasSize(width, height, window.devicePixelRatio || 1);
      if (canvas.width !== resolution.width || canvas.height !== resolution.height) {
        canvas.width = resolution.width;
        canvas.height = resolution.height;
      }
      context.setTransform(resolution.dpr, 0, 0, resolution.dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const lightTheme = isLight(background);
      const accent = phaseRef.current === 'error' ? failure : primary;
      // On paper the additive pass would just wash out, so the sculpture is
      // drawn as a dark technical trace instead of an emissive one.
      const blend: GlobalCompositeOperation = lightTheme ? 'source-over' : 'lighter';
      const glowScale = lightTheme ? 0 : 1;
      const traceScale = lightTheme ? 2.1 : 1;
      const strandColor: readonly [Rgb, Rgb] = lightTheme
        ? [mix(ink, background, 0.12), accent]
        : [mix(ink, [186, 214, 255], 0.34), mix(accent, [255, 26, 96], 0.35)];
      const strandCore: readonly [Rgb, Rgb] = lightTheme
        ? [ink, mix(accent, VOID, 0.25)]
        : [WHITE, mix(accent, WHITE, 0.66)];
      const voidTone = lightTheme ? background : mix(background, VOID, 0.72);

      const live = reducedMotion ? 0 : readLevel();
      const target = resolveVoiceHologramEnergy(phaseRef.current, live);
      smoothed += (target - smoothed) * 0.14;
      const energy = smoothed;

      const clock = reducedMotion ? 2_400 : timestamp;
      const speed = phaseSpeed(phaseRef.current);
      const layout = resolveVoiceHologramLayout(width, height);
      const centreX = layout.centreX;
      const centreY = layout.centreY;
      const radius = layout.radius * (1 + energy * 0.04);
      // One continuous clockwise turn. The mark is symmetric under a quarter
      // turn, so the rotation reads as an endless loop with no seam to hide.
      const elapsed = lastFrame === null ? 0 : timestamp - lastFrame;
      lastFrame = timestamp;
      if (!reducedMotion) turn = advanceVoiceHologramSpin(turn, elapsed, speed);
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      const half = mark.half * radius;
      const band = mark.band * radius;
      const corner = mark.corner * radius;

      // ---- backdrop ------------------------------------------------------
      // The canvas owns the whole stage, so it has to hand back to the app's
      // surface colour at its own edges — otherwise the deep field the neon
      // needs would end in a visible seam against the header and transcript.
      context.globalCompositeOperation = 'source-over';
      const shell = context.createRadialGradient(
        centreX,
        centreY,
        radius * 1.15,
        centreX,
        centreY,
        Math.hypot(width, height) * 0.5,
      );
      shell.addColorStop(0, rgba(voidTone, 1));
      shell.addColorStop(1, rgba(background, 1));
      context.fillStyle = shell;
      context.fillRect(0, 0, width, height);
      const wash = context.createRadialGradient(centreX, centreY, 0, centreX, centreY, radius * 2.1);
      wash.addColorStop(0, rgba(accent, lightTheme ? 0.03 : 0.055 + energy * 0.05));
      wash.addColorStop(0.42, rgba(accent, lightTheme ? 0.015 : 0.02));
      wash.addColorStop(1, rgba(accent, 0));
      context.fillStyle = wash;
      context.fillRect(0, 0, width, height);

      // ---- dust field ----------------------------------------------------
      context.globalCompositeOperation = blend;
      for (const ring of field.rings) {
        context.beginPath();
        context.arc(centreX, centreY, radius * ring.radius, 0, TAU);
        context.strokeStyle = rgba(
          ring.radius > 1.4 ? strandColor[1] : strandColor[0],
          ring.alpha * (2 + energy) * traceScale,
        );
        context.lineWidth = 1;
        context.setLineDash([ring.dash[0], ring.dash[1]]);
        context.stroke();
      }
      context.setLineDash([]);
      for (const mote of field.dust) {
        const angle = mote.angle + (clock / 1_000) * mote.drift * speed;
        const twinkle = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(clock / 900 + mote.angle * 7);
        const x = centreX + Math.cos(angle) * radius * mote.radius;
        const y = centreY + Math.sin(angle) * radius * mote.radius;
        context.fillStyle = rgba(
          strandColor[mote.tint],
          mote.brightness * twinkle * (0.46 + energy * 0.4) * traceScale,
        );
        context.fillRect(x, y, mote.size, mote.size);
      }

      // ---- the woven mark -------------------------------------------------
      const trace = (halfSide: number, cornerRadius: number, spin: number): void => {
        context.save();
        context.translate(centreX, centreY);
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
        const spin = turn + (strand === 1 ? Math.PI / 4 : 0);
        const color = strandColor[strand];
        const core = strandCore[strand];
        const samples = field.samples[strand];
        // The accent only lights the red channel, so at equal alpha its mesh
        // reads dimmer than the ink strand's; lift it back to parity.
        const heat = strand === 1 ? 1.28 : 1;

        // Carve the ribbon (plus a hairline seam) out of everything beneath so
        // this strand genuinely passes IN FRONT of the one already painted.
        context.globalCompositeOperation = 'source-over';
        context.setLineDash([]);
        context.lineJoin = 'round';
        // Carve with the BACKDROP gradient, not a flat tone, so the seam is
        // invisible wherever the mark reaches into the backdrop's falloff.
        context.strokeStyle = shell;
        context.lineWidth = band * 2 + radius * 0.024;
        trace(half, corner, spin);
        context.stroke();

        context.globalCompositeOperation = blend;

        // Ribbon interior: a wash, longitudinal filaments and transverse ticks
        // — the mesh that makes the light read as material rather than a line.
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
          const ix = sample.x - sample.nx * mark.band;
          const iy = sample.y - sample.ny * mark.band;
          const ox = sample.x + sample.nx * mark.band;
          const oy = sample.y + sample.ny * mark.band;
          context.moveTo(
            centreX + (ix * cos - iy * sin) * radius,
            centreY + (ix * sin + iy * cos) * radius,
          );
          context.lineTo(
            centreX + (ox * cos - oy * sin) * radius,
            centreY + (ox * sin + oy * cos) * radius,
          );
        }
        context.strokeStyle = rgba(color, (0.13 + energy * 0.08) * heat * traceScale);
        context.stroke();

        // Neon contours. The bloom is a real canvas shadow rather than a stack
        // of ever-wider translucent strokes: stepped strokes band together into
        // a visible grey shelf around the mark, a shadow falls off smoothly and
        // hugs the rounded corners exactly.
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

        // Holographic grain.
        for (const particle of strandParticles[strand]) {
          const sample = samples[particle.index];
          if (!sample) continue;
          const breath = reducedMotion
            ? 0
            : Math.sin(clock / 620 + particle.phase) * (0.1 + energy * 0.35);
          const across = mark.band * (particle.offset + breath * 0.06);
          const px = sample.x + sample.nx * across;
          const py = sample.y + sample.ny * across;
          const x = centreX + (px * cos - py * sin) * radius;
          const y = centreY + (px * sin + py * cos) * radius;
          const twinkle = reducedMotion ? 0.8 : 0.55 + 0.45 * Math.sin(clock / 480 + particle.phase * 3);
          const alpha = particle.brightness * twinkle * (0.4 + energy * 0.6) * heat * traceScale;
          const size = particle.size * (0.9 + energy * 0.4);
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
      for (const crossing of crossings) {
        if (crossing.over !== 0) continue;
        const x = centreX + (crossing.x * cos - crossing.y * sin) * radius;
        const y = centreY + (crossing.x * sin + crossing.y * cos) * radius;
        context.moveTo(x + mark.weave * radius, y);
        context.arc(x, y, mark.weave * radius, 0, TAU);
      }
      context.clip();
      paintStrand(0);
      context.restore();

      // ---- crossing flares -------------------------------------------------
      context.globalCompositeOperation = blend;
      context.setLineDash([]);
      const flarePulse = reducedMotion ? 1 : 0.86 + 0.14 * Math.sin(clock / 700);
      for (const crossing of crossings) {
        const x = centreX + (crossing.x * cos - crossing.y * sin) * radius;
        const y = centreY + (crossing.x * sin + crossing.y * cos) * radius;
        const color = strandColor[crossing.over];
        const core = strandCore[crossing.over];
        const scale = radius * (0.24 + energy * 0.06) * flarePulse;
        // On paper a radial bloom is just a grey smudge, so the flare degrades
        // to a drawn registration cross rather than a light burst.
        if (!lightTheme) {
          const bloom = context.createRadialGradient(x, y, 0, x, y, scale);
          bloom.addColorStop(0, rgba(core, 0.62));
          bloom.addColorStop(0.14, rgba(core, 0.26));
          bloom.addColorStop(0.38, rgba(color, 0.1));
          bloom.addColorStop(1, rgba(color, 0));
          context.fillStyle = bloom;
          context.fillRect(x - scale, y - scale, scale * 2, scale * 2);
        }

        for (const ray of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
          const long = ray === 0 || ray === Math.PI / 2;
          const strength = lightTheme ? 0.5 : 1;
          const reach = scale * (long ? 1.5 : 0.62) * (lightTheme ? 0.34 : 1);
          const dx = Math.cos(ray + turn) * reach;
          const dy = Math.sin(ray + turn) * reach;
          const streak = context.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
          streak.addColorStop(0, rgba(color, 0));
          streak.addColorStop(0.5, rgba(core, (long ? 0.5 : 0.28) * strength));
          streak.addColorStop(1, rgba(color, 0));
          context.strokeStyle = streak;
          context.lineWidth = long ? 1.5 : 1;
          context.beginPath();
          context.moveTo(x - dx, y - dy);
          context.lineTo(x + dx, y + dy);
          context.stroke();
        }
      }

      // ---- tool tethers ----------------------------------------------------
      const endpoints = [
        { x: width * 0.17, y: height * 0.28 },
        { x: width * 0.83, y: height * 0.3 },
        { x: width * 0.82, y: height * 0.72 },
      ] as const;
      context.setLineDash([2, 7]);
      context.lineWidth = 1;
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
        context.strokeStyle = rgba(accent, (0.34 + energy * 0.22) * traceScale);
        context.stroke();
      }
      context.setLineDash([]);
      context.globalCompositeOperation = 'source-over';

      if (!reducedMotion && visible) frame = requestAnimationFrame(draw);
    };

    const redraw = (): void => {
      if (cancelled) return;
      cancelAnimationFrame(frame);
      draw(performance.now());
    };
    redrawRef.current = redraw;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : null;
    observer?.observe(canvas);
    const themeObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          readThemeColors();
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

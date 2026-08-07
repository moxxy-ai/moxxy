import { useEffect, useRef, type RefObject } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { useReducedMotion } from '../shell/useReducedMotion';
import {
  buildVoiceHologramSegments,
  buildVoiceHologramField,
  groupVoiceHologramSegments,
  orderVoiceHologramParticles,
  resolveVoiceCanvasSize,
  resolveVoiceHologramEnergy,
  resolveVoiceHologramLayout,
  VOICE_HOLOGRAM_FILAMENT_COUNT,
} from './voice-hologram-field';
import type { HologramCrossing, HologramPoint, HologramSegment } from './voice-hologram-field';

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

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function phaseSpeed(phase: VoiceCallPhase): number {
  if (phase === 'working' || phase === 'thinking' || phase === 'synthesizing') return 1.5;
  if (phase === 'speaking') return 1.25;
  if (phase === 'paused' || phase === 'error') return 0.35;
  return 0.75;
}

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
    let frame = 0;
    let cancelled = false;
    let visible = document.visibilityState !== 'hidden';
    let smoothed = 0;
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
    const orderedParticles = orderVoiceHologramParticles(field.logo);
    const centreFilament = Math.floor(VOICE_HOLOGRAM_FILAMENT_COUNT / 2);
    const strands = [
      field.logo.filter((particle) => particle.strand === 0 && particle.filament === centreFilament),
      field.logo.filter((particle) => particle.strand === 1 && particle.filament === centreFilament),
    ] as const;
    const centreSegments = strands.map(buildVoiceHologramSegments);
    const centreSegmentGroups = centreSegments.map((segments) => ({
      under: groupVoiceHologramSegments(segments, 'under'),
      none: groupVoiceHologramSegments(segments, 'none'),
      over: groupVoiceHologramSegments(segments, 'over'),
    }));
    const filamentSegments = ([0, 1] as const).map((strand) => (
      Array.from({ length: VOICE_HOLOGRAM_FILAMENT_COUNT }, (_, filament) => (
        buildVoiceHologramSegments(field.logo.filter((particle) => (
          particle.strand === strand && particle.filament === filament
        )))
      )).flat()
    ));

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

      const phaseColor = phaseRef.current === 'error' ? failure : primary;
      const live = reducedMotion ? 0 : readLevel();
      const target = resolveVoiceHologramEnergy(phaseRef.current, live);
      smoothed += (target - smoothed) * 0.14;

      const clock = reducedMotion ? 2_400 : timestamp;
      const speed = phaseSpeed(phaseRef.current);
      const layout = resolveVoiceHologramLayout(width, height);
      const centreX = layout.centreX;
      const centreY = layout.centreY;
      const radius = layout.radius * (1 + smoothed * 0.055);
      const rotation = reducedMotion ? 0 : Math.sin(clock / 5_800) * 0.035;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);

      context.save();
      context.globalCompositeOperation = 'source-over';
      const halo = context.createRadialGradient(centreX, centreY, radius * 0.15, centreX, centreY, radius * 1.25);
      halo.addColorStop(0, rgba(phaseColor, 0.015 + smoothed * 0.02));
      halo.addColorStop(0.65, rgba(phaseColor, 0.005));
      halo.addColorStop(1, rgba(phaseColor, 0));
      context.fillStyle = halo;
      context.fillRect(centreX - radius * 1.3, centreY - radius * 1.3, radius * 2.6, radius * 2.6);

      const lightTheme = background[0] + background[1] + background[2] > 480;
      context.globalCompositeOperation = lightTheme ? 'source-over' : 'lighter';
      context.beginPath();
      context.arc(centreX, centreY, radius * 1.08, 0.18, Math.PI * 1.48);
      context.arc(centreX, centreY, radius * 1.2, Math.PI * 1.08, Math.PI * 1.92);
      context.strokeStyle = rgba(phaseColor, 0.09 + smoothed * 0.06);
      context.lineWidth = 0.7;
      context.setLineDash([1, 8]);
      context.stroke();

      const transformPoint = (particle: HologramPoint): { readonly x: number; readonly y: number } => ({
        x: centreX + (particle.x * cos - particle.y * sin) * radius,
        y: centreY + (particle.x * sin + particle.y * cos) * radius,
      });
      const drawSegments = (
        segmentsByStrand: ReadonlyArray<ReadonlyArray<HologramSegment>>,
        crossing: HologramCrossing,
        draw: (segment: HologramSegment, color: Rgb) => void,
      ): void => {
        segmentsByStrand.forEach((segments, strand) => {
          const color = strand === 0 ? ink : phaseColor;
          segments.forEach((segment) => {
            if (segment.crossing === crossing) draw(segment, color);
          });
        });
      };
      const drawRibbonGroups = (
        crossing: HologramCrossing,
        draw: (group: ReadonlyArray<HologramSegment>, color: Rgb) => void,
      ): void => {
        centreSegmentGroups.forEach((groups, strand) => {
          const color = strand === 0 ? ink : phaseColor;
          groups[crossing].forEach((group) => draw(group, color));
        });
      };
      const beginRibbonPath = (group: ReadonlyArray<HologramSegment>): boolean => {
        const first = group[0];
        if (!first) return false;
        const start = transformPoint(first.start);
        context.beginPath();
        context.moveTo(start.x, start.y);
        group.forEach((segment) => {
          const end = transformPoint(segment.end);
          context.lineTo(end.x, end.y);
        });
        return true;
      };
      const strokeRibbonGroup = (group: ReadonlyArray<HologramSegment>, color: Rgb): void => {
        if (!beginRibbonPath(group)) return;
        context.strokeStyle = rgba(color, 0.14 + smoothed * 0.04);
        context.lineWidth = radius * 0.17;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.setLineDash([]);
        context.stroke();
        context.strokeStyle = rgba(color, 0.22 + smoothed * 0.05);
        context.lineWidth = radius * 0.11;
        context.stroke();
      };
      const strokeFilamentSegment = (segment: HologramSegment, color: Rgb): void => {
        const start = transformPoint(segment.start);
        const end = transformPoint(segment.end);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.strokeStyle = rgba(color, 0.26 + smoothed * 0.14);
        context.lineWidth = segment.start.filament === centreFilament ? 1.25 : 0.65;
        context.lineCap = 'round';
        context.setLineDash(segment.start.filament % 2 === 0 ? [5, 2] : [1.5, 2.5]);
        context.stroke();
      };
      const strokeForegroundRibbonGroup = (group: ReadonlyArray<HologramSegment>, color: Rgb): void => {
        if (!beginRibbonPath(group)) return;
        context.strokeStyle = rgba(color, 0.14 + smoothed * 0.04);
        context.lineWidth = radius * 0.17;
        context.lineCap = 'butt';
        context.lineJoin = 'round';
        context.setLineDash([]);
        context.stroke();
        context.strokeStyle = rgba(color, 0.22 + smoothed * 0.05);
        context.lineWidth = radius * 0.1;
        context.stroke();
      };
      const strokeForegroundFilamentSegment = (segment: HologramSegment, color: Rgb): void => {
        const start = transformPoint(segment.start);
        const end = transformPoint(segment.end);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.strokeStyle = rgba(color, 0.62);
        context.lineWidth = segment.start.filament === centreFilament ? 1.4 : 0.75;
        context.lineCap = 'round';
        context.setLineDash(segment.start.filament % 2 === 0 ? [5, 2] : [1.5, 2.5]);
        context.stroke();
      };
      const drawParticle = (particle: HologramPoint): void => {
        const wave = reducedMotion ? 0 : Math.sin(clock / 560 + particle.phase) * (0.008 + smoothed * 0.018);
        const px = particle.x * (1 + wave);
        const py = particle.y * (1 + wave);
        const x = centreX + (px * cos - py * sin) * radius;
        const y = centreY + (px * sin + py * cos) * radius;
        const color = particle.strand === 0 ? ink : phaseColor;
        const filamentEmphasis = particle.filament === 0
          || particle.filament === VOICE_HOLOGRAM_FILAMENT_COUNT - 1
          ? 1.16
          : particle.filament === centreFilament
            ? 1.08
            : 1;
        const strandAlpha = particle.strand === 0 ? 0.78 : 1;
        const alpha = particle.brightness * strandAlpha * (0.5 + particle.weave * 0.5) * (0.68 + smoothed * 0.32);
        const size = particle.size * filamentEmphasis * (0.95 + smoothed * 0.55);
        const glowSize = size * 2.8;
        context.fillStyle = rgba(color, alpha * 0.22);
        context.fillRect(x - glowSize / 2, y - glowSize / 2, glowSize, glowSize);
        context.fillStyle = rgba(color, alpha);
        context.fillRect(x - size / 2, y - size / 2, size, size);
        if (particle.phase < 0.27) {
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x + Math.cos(particle.phase * 20) * (3 + smoothed * 4), y + Math.sin(particle.phase * 20) * (3 + smoothed * 4));
          context.strokeStyle = rgba(color, alpha * 0.45);
          context.lineWidth = 0.55;
          context.stroke();
        }
      };

      context.globalCompositeOperation = 'source-over';
      centreSegments.forEach((segments, strand) => {
        strokeRibbonGroup(segments, strand === 0 ? ink : phaseColor);
      });
      drawSegments(filamentSegments, 'under', strokeFilamentSegment);
      drawSegments(filamentSegments, 'none', strokeFilamentSegment);
      context.setLineDash([]);
      orderedParticles
        .filter((particle) => particle.crossing !== 'over')
        .forEach(drawParticle);

      context.globalCompositeOperation = 'source-over';
      drawRibbonGroups('over', (group) => {
        if (!beginRibbonPath(group)) return;
        context.strokeStyle = rgba(background, lightTheme ? 0.96 : 0.9);
        context.lineWidth = radius * 0.185;
        context.lineCap = 'butt';
        context.setLineDash([]);
        context.stroke();
      });
      context.globalCompositeOperation = 'source-over';
      drawRibbonGroups('over', strokeForegroundRibbonGroup);
      drawSegments(filamentSegments, 'over', strokeForegroundFilamentSegment);
      context.setLineDash([]);
      orderedParticles
        .filter((particle) => particle.crossing === 'over')
        .forEach(drawParticle);
      context.globalCompositeOperation = lightTheme ? 'source-over' : 'lighter';

      for (const mote of field.orbits) {
        const angle = mote.angle + (clock / 1_000) * mote.speed * speed;
        const orbitRadius = radius * mote.radius * 1.48;
        const x = centreX + Math.cos(angle) * orbitRadius;
        const y = centreY + Math.sin(angle) * orbitRadius * 0.72;
        context.fillStyle = rgba(mote.phase > Math.PI ? ink : phaseColor, 0.16 + smoothed * 0.2);
        context.fillRect(x, y, mote.size, mote.size);
      }

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
        context.moveTo(centreX + direction * radius * 0.82, centreY + (endpoint.y - centreY) * 0.18);
        context.bezierCurveTo(
          centreX + direction * radius * 1.15,
          endpoint.y,
          endpoint.x - direction * 34,
          endpoint.y,
          endpoint.x,
          endpoint.y,
        );
        context.strokeStyle = rgba(phaseColor, 0.34 + smoothed * 0.22);
        context.stroke();
      }
      context.restore();

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

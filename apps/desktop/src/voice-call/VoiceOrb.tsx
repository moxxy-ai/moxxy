import { useEffect, useRef } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { useReducedMotion } from '../shell/useReducedMotion';
import { resolveVoiceOrbPalette } from './voice-orb-palette';

interface LiveAnalyser {
  readonly fftSize: number;
  getFloatTimeDomainData(target: Float32Array): void;
}

function asAnalyser(value: unknown): LiveAnalyser | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LiveAnalyser>;
  return typeof candidate.fftSize === 'number' &&
    typeof candidate.getFloatTimeDomainData === 'function'
    ? candidate as LiveAnalyser
    : null;
}

function phaseMotion(phase: VoiceCallPhase): number {
  if (phase === 'speaking') return 1;
  if (phase === 'synthesizing' || phase === 'thinking' || phase === 'working') return 0.72;
  if (phase === 'transcribing') return 0.56;
  if (phase === 'listening') return 0.42;
  if (phase === 'checking') return 0.3;
  return 0.16;
}

function readLevel(analyser: LiveAnalyser | null, buffer: Float32Array): number {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / buffer.length) * 5.5);
}

/** Decorative, audio-reactive energy core. Conversation logic lives in hooks. */
export function VoiceOrb({
  phase,
  microphoneMuted,
  inputAnalyser,
  outputAnalyser,
}: {
  readonly phase: VoiceCallPhase;
  readonly microphoneMuted: boolean;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const activeAnalyser = asAnalyser(
      phase === 'speaking' ? outputAnalyser : phase === 'listening' ? inputAnalyser : null,
    );
    const sampleBuffer = new Float32Array(Math.max(32, activeAnalyser?.fftSize ?? 256));
    const palette = resolveVoiceOrbPalette(getComputedStyle(canvas), phase === 'error');
    let animationFrame = 0;

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const size = Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(resize);
    observer?.observe(canvas);

    const draw = (now: number): void => {
      const size = Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
      const center = size / 2;
      const baseRadius = size * 0.205;
      const time = reducedMotion ? 0 : now / 1_000;
      const audioLevel = readLevel(activeAnalyser, sampleBuffer);
      const motion = phaseMotion(phase);
      const pulse = reducedMotion
        ? 0.18
        : 0.18 + Math.sin(time * (1.5 + motion * 2.8)) * 0.045;
      const energy = Math.min(1, motion * 0.55 + audioLevel * 0.9 + pulse);
      const primary = palette.primary;
      const hot = palette.highlight;

      context.clearRect(0, 0, size, size);
      const haze = context.createRadialGradient(center, center, 0, center, center, size * 0.48);
      haze.addColorStop(0, `rgba(${hot}, ${0.22 + energy * 0.22})`);
      haze.addColorStop(0.32, `rgba(${primary}, ${0.11 + energy * 0.13})`);
      haze.addColorStop(1, `rgba(${primary}, 0)`);
      context.fillStyle = haze;
      context.fillRect(0, 0, size, size);

      context.save();
      context.translate(center, center);
      context.globalCompositeOperation = 'lighter';

      for (let ring = 0; ring < 5; ring += 1) {
        const ringRadius = baseRadius * (1.05 + ring * 0.25 + energy * 0.035 * ring);
        const tilt = 0.45 + ring * 0.085;
        context.save();
        context.rotate((ring % 2 === 0 ? 1 : -1) * time * (0.16 + ring * 0.035));
        context.scale(1, tilt);
        context.beginPath();
        context.arc(0, 0, ringRadius, 0, Math.PI * 2);
        context.setLineDash([size * 0.025, size * (0.012 + ring * 0.004)]);
        context.lineDashOffset = time * (ring % 2 === 0 ? 18 : -15);
        context.lineWidth = Math.max(0.7, size * (0.0028 - ring * 0.00028));
        context.strokeStyle = `rgba(${primary}, ${0.72 - ring * 0.09 + energy * 0.13})`;
        context.stroke();
        context.restore();
      }

      for (let ray = 0; ray < 28; ray += 1) {
        const angle = (ray / 28) * Math.PI * 2 + time * 0.07;
        const inner = baseRadius * (1.23 + (ray % 3) * 0.08);
        const outer = inner + size * (0.025 + (ray % 5) * 0.008) * (0.7 + energy);
        context.beginPath();
        context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
        context.lineWidth = ray % 4 === 0 ? 1.6 : 0.7;
        context.strokeStyle = `rgba(${hot}, ${0.28 + energy * 0.5})`;
        context.stroke();
      }

      for (let particle = 0; particle < 72; particle += 1) {
        const seed = particle * 12.9898;
        const orbit = baseRadius * (1.05 + ((particle * 37) % 100) / 78);
        const speed = 0.04 + (particle % 7) * 0.012;
        const angle = seed + time * speed * (particle % 2 === 0 ? 1 : -1);
        const wobble = Math.sin(time * 0.8 + seed) * size * 0.009 * energy;
        const x = Math.cos(angle) * (orbit + wobble);
        const y = Math.sin(angle) * (orbit * (0.58 + (particle % 4) * 0.08));
        const radius = 0.45 + (particle % 4) * 0.22 + energy * 0.45;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${hot}, ${0.25 + energy * 0.55})`;
        context.fill();
      }

      const coreRadius = baseRadius * (0.62 + energy * 0.12);
      const core = context.createRadialGradient(0, 0, 0, 0, 0, coreRadius);
      core.addColorStop(0, `rgba(${hot}, ${0.92 + energy * 0.08})`);
      core.addColorStop(0.34, `rgba(${primary}, ${0.78 + energy * 0.16})`);
      core.addColorStop(1, `rgba(${primary}, 0)`);
      context.fillStyle = core;
      context.beginPath();
      context.arc(0, 0, coreRadius, 0, Math.PI * 2);
      context.fill();
      context.restore();

      if (!reducedMotion) animationFrame = requestAnimationFrame(draw);
    };

    draw(0);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer?.disconnect();
    };
  }, [inputAnalyser, outputAnalyser, phase, reducedMotion]);

  return (
    <div
      className={`voice-orb voice-orb--${phase}${microphoneMuted ? ' voice-orb--microphone-muted' : ''}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="voice-orb-canvas" />
    </div>
  );
}

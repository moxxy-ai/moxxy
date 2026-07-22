import { useEffect, useRef, type RefObject } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { useReducedMotion } from '../shell/useReducedMotion';
import {
  resolveVoiceAvatarFrame,
  smoothVoiceAvatarAmplitude,
  type VoiceAvatarFrame,
} from './voice-avatar-animation';

interface LiveAnalyser {
  readonly fftSize: number;
  getFloatTimeDomainData(target: Float32Array): void;
}

type AvatarFrames = Readonly<Record<VoiceAvatarFrame, HTMLImageElement>>;
let framesPromise: Promise<AvatarFrames> | null = null;

const FRAME_URLS: Readonly<Record<VoiceAvatarFrame, string>> = Object.freeze({
  idle: new URL('./assets/brick-girl/brick-girl-idle.png', import.meta.url).href,
  medium: new URL('./assets/brick-girl/brick-girl-mouth-medium.png', import.meta.url).href,
  wide: new URL('./assets/brick-girl/brick-girl-mouth-wide.png', import.meta.url).href,
  round: new URL('./assets/brick-girl/brick-girl-mouth-o.png', import.meta.url).href,
  blink: new URL('./assets/brick-girl/brick-girl-blink.png', import.meta.url).href,
});

function asAnalyser(value: unknown): LiveAnalyser | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<LiveAnalyser>;
  return typeof candidate.fftSize === 'number'
    && typeof candidate.getFloatTimeDomainData === 'function'
    ? candidate as LiveAnalyser
    : null;
}

function readLevel(analyser: LiveAnalyser | null, buffer: Float32Array): number {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(buffer);
  let sumSquares = 0;
  for (const sample of buffer) sumSquares += sample * sample;
  return Math.min(1, Math.sqrt(sumSquares / buffer.length) * 6);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load Moxxy avatar frame: ${url}`));
    image.src = url;
  });
}

async function loadFrames(): Promise<AvatarFrames> {
  const [idle, medium, wide, round, blink] = await Promise.all([
    loadImage(FRAME_URLS.idle),
    loadImage(FRAME_URLS.medium),
    loadImage(FRAME_URLS.wide),
    loadImage(FRAME_URLS.round),
    loadImage(FRAME_URLS.blink),
  ]);
  const dimensions = new Set(
    [idle, medium, wide, round, blink]
      .map((image) => `${image.naturalWidth}x${image.naturalHeight}`),
  );
  if (dimensions.size !== 1) {
    throw new Error(`Moxxy avatar frames are misaligned: ${[...dimensions].join(', ')}`);
  }
  return Object.freeze({ idle, medium, wide, round, blink });
}

function getFrames(): Promise<AvatarFrames> {
  framesPromise ??= loadFrames();
  return framesPromise;
}

function randomBlinkDelay(): number {
  return 3_000 + Math.random() * 3_500;
}

export function useVoiceAvatarAnimation({
  phase,
  inputAnalyser,
  outputAnalyser,
}: {
  readonly phase: VoiceCallPhase;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
}): RefObject<HTMLCanvasElement> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const input = asAnalyser(inputAnalyser);
    const output = asAnalyser(outputAnalyser);
    const activeAnalyser = phase === 'speaking'
      ? output
      : phase === 'listening'
        ? input
        : null;
    const sampleBuffer = new Float32Array(Math.max(32, activeAnalyser?.fftSize ?? 256));
    let cancelled = false;
    let animationFrameId = 0;
    if (canvas.dataset.avatarState !== 'ready') canvas.dataset.avatarState = 'loading';

    void getFrames().then((frames) => {
      if (cancelled) return;
      const firstFrame = frames.idle;
      canvas.width = firstFrame.naturalWidth;
      canvas.height = firstFrame.naturalHeight;
      context.imageSmoothingEnabled = false;
      canvas.dataset.avatarState = 'ready';

      let lastTimestamp = performance.now();
      let lastMouthChange = lastTimestamp;
      let mouthFrame = 0;
      let smoothedAmplitude = 0;
      let blinkUntil = 0;
      let nextBlinkAt = lastTimestamp + randomBlinkDelay();

      const draw = (timestamp: number): void => {
        if (cancelled) return;
        const deltaSeconds = Math.min((timestamp - lastTimestamp) / 1_000, 0.1);
        const elapsedSeconds = timestamp / 1_000;
        lastTimestamp = timestamp;

        const liveAmplitude = readLevel(activeAnalyser, sampleBuffer);
        const speaking = phase === 'speaking';
        const targetAmplitude = speaking || phase === 'listening' ? liveAmplitude : 0;
        smoothedAmplitude = smoothVoiceAvatarAmplitude(
          smoothedAmplitude,
          targetAmplitude,
          deltaSeconds,
        );

        if (!reducedMotion && timestamp >= nextBlinkAt) {
          blinkUntil = timestamp + 140;
          nextBlinkAt = blinkUntil + randomBlinkDelay();
        }
        if (timestamp - lastMouthChange >= 75) {
          lastMouthChange = timestamp;
          mouthFrame += 1;
        }

        const frameName = resolveVoiceAvatarFrame({
          speaking,
          blinking: !reducedMotion && timestamp < blinkUntil,
          amplitude: reducedMotion && speaking ? 0.2 : smoothedAmplitude,
          mouthFrame,
        });
        const frame = frames[frameName];
        const idleScale = reducedMotion ? 1 : 1 + Math.sin(elapsedSeconds * 1.7) * 0.006;
        const audioScale = reducedMotion ? 1 : 1 + smoothedAmplitude * (speaking ? 0.018 : 0.006);
        const scale = idleScale * audioScale;
        const yOffset = reducedMotion
          ? 0
          : Math.sin(elapsedSeconds * 1.25) * canvas.height * 0.004
            + smoothedAmplitude * canvas.height * (speaking ? 0.006 : 0.002);

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.translate(canvas.width / 2, canvas.height / 2 + yOffset);
        context.scale(scale, scale);
        context.drawImage(
          frame,
          -canvas.width / 2,
          -canvas.height / 2,
          canvas.width,
          canvas.height,
        );
        context.restore();

        if (!reducedMotion) animationFrameId = requestAnimationFrame(draw);
      };

      draw(performance.now());
    }).catch((error: unknown) => {
      if (cancelled) return;
      canvas.dataset.avatarState = 'error';
      console.error('[moxxy] voice avatar failed to load', error);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrameId);
    };
  }, [inputAnalyser, outputAnalyser, phase, reducedMotion]);

  return canvasRef;
}

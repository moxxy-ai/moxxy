import { useEffect, useRef } from 'react';
import { shouldPaintVoiceFrame } from '../voice-call/voice-pacing';
import type { AudioSpectrumAnalyser } from './focus-audio-visualization';
import {
  FOCUS_SPECTRO_BARS,
  projectFocusSpectroLevels,
  resolveFocusSpectroGeometry,
  resolveFocusSpectroGradient,
} from './focus-spectro.js';

export function useSpectroBackground(
  analyser: AudioSpectrumAnalyser,
): React.RefObject<HTMLCanvasElement> {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef(new Float32Array(FOCUS_SPECTRO_BARS));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let lastPaint: number | null = null;
    let gradientStops = resolveFocusSpectroGradient((token) => (
      getComputedStyle(canvas).getPropertyValue(token)
    ));

    const sizeCanvas = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (): void => {
      if (document.hidden && !reduceMotion) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const timestamp = performance.now();
      if (!reduceMotion && !shouldPaintVoiceFrame(lastPaint, timestamp)) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastPaint = timestamp;
      if (!reduceMotion) raf = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(spectrum);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;

      const levels = levelsRef.current;
      projectFocusSpectroLevels(spectrum, levels);
      context.clearRect(0, 0, width, height);

      const geometry = resolveFocusSpectroGeometry(
        width,
        FOCUS_SPECTRO_BARS,
        1,
      );
      const maxBarHeight = height * 0.95;
      const minBarHeight = height * 0.06;
      const gradient = context.createLinearGradient(0, 0, 0, height);
      for (const stop of gradientStops) {
        gradient.addColorStop(stop.offset, stop.color);
      }
      context.fillStyle = gradient;

      for (let index = 0; index < FOCUS_SPECTRO_BARS; index += 1) {
        const level = levels[index] ?? 0;
        const barHeight = Math.max(minBarHeight, level * maxBarHeight);
        const x = index * geometry.step;
        context.fillRect(x, height - barHeight, geometry.barWidth, barHeight);
      }
    };

    sizeCanvas();
    draw();

    const resizeObserver = new ResizeObserver(() => {
      sizeCanvas();
      if (reduceMotion) draw();
    });
    resizeObserver.observe(canvas);

    const themeObserver = new MutationObserver(() => {
      gradientStops = resolveFocusSpectroGradient((token) => (
        getComputedStyle(canvas).getPropertyValue(token)
      ));
      if (reduceMotion) draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [analyser]);

  return canvasRef;
}

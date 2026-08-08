import { useEffect, useRef, type RefObject } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { useReducedMotion } from '../shell/useReducedMotion';
import {
  advanceVoiceHologramSpin,
  resolveVoiceHologramEnergy,
  resolveVoiceHologramSpeed,
  shouldPaintVoiceHologramFrame,
} from '../voice-call/voice-hologram-field';
import { createAnalyserLevelBuffers, readAnalyserLevel } from '../voice-call/voice-analyser-level';

/**
 * Turns and lights the Focus widget's Moxxy mark.
 *
 * This is the small-scale expression of the Voice Mode hologram: the same
 * clockwise turn, the same phase-scaled speed and the same energy curve, driven
 * by the same shared helpers. It publishes them as two CSS custom properties
 * rather than painting a canvas, because at the widget's ~64px the sculpture's
 * particle lattice would land under one device pixel per cell — the vector mark
 * stays legible, costs nothing, and can be composited by the GPU.
 */
export function useFocusMarkAnimation({
  phase,
  inputAnalyser,
  outputAnalyser,
}: {
  readonly phase: VoiceCallPhase;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
}): RefObject<HTMLDivElement> {
  const markRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const phaseRef = useRef(phase);
  const inputRef = useRef(inputAnalyser);
  const outputRef = useRef(outputAnalyser);
  phaseRef.current = phase;
  inputRef.current = inputAnalyser;
  outputRef.current = outputAnalyser;

  useEffect(() => {
    const element = markRef.current;
    if (!element) return;

    const buffers = createAnalyserLevelBuffers();
    let frame = 0;
    let cancelled = false;
    let visible = document.visibilityState !== 'hidden';
    let turn = 0;
    let energy = 0;
    let lastFrame: number | null = null;
    let lastPaint: number | null = null;

    const paint = (timestamp: number): void => {
      if (cancelled) return;
      // Writing the two properties is cheap, but each write costs a style
      // recalculation and a composite in an always-on-top window that never
      // closes. Half the display's frames carry this turn just as well.
      if (!reducedMotion && !shouldPaintVoiceHologramFrame(lastPaint, timestamp)) {
        if (visible) frame = requestAnimationFrame(paint);
        return;
      }
      lastPaint = timestamp;
      const live = reducedMotion
        ? 0
        : readAnalyserLevel(
            phaseRef.current === 'speaking'
              ? outputRef.current
              : phaseRef.current === 'listening'
                ? inputRef.current
                : null,
            buffers,
          );
      energy += (resolveVoiceHologramEnergy(phaseRef.current, live) - energy) * 0.14;
      const elapsed = lastFrame === null ? 0 : timestamp - lastFrame;
      lastFrame = timestamp;
      if (!reducedMotion) {
        turn = advanceVoiceHologramSpin(turn, elapsed, resolveVoiceHologramSpeed(phaseRef.current));
      }
      element.style.setProperty('--focus-mark-turn', `${turn.toFixed(4)}rad`);
      element.style.setProperty('--focus-mark-energy', energy.toFixed(3));
      if (!reducedMotion && visible) frame = requestAnimationFrame(paint);
    };

    const onVisibility = (): void => {
      visible = document.visibilityState !== 'hidden';
      if (visible) {
        cancelAnimationFrame(frame);
        paint(performance.now());
      } else {
        cancelAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    paint(performance.now());

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reducedMotion]);

  return markRef;
}

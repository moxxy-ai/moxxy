import { useEffect, useRef, type RefObject } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { useReducedMotion } from '../shell/useReducedMotion';
import {
  resolveVoiceEnergy,
  shouldPaintVoiceFrame,
  VOICE_PULSE_FRAME_MS,
} from './voice-pacing';
import { createAnalyserLevelBuffers, readAnalyserLevel } from './voice-analyser-level';

/** CSS custom property the stylesheets read to size the pulse. */
export const VOICE_PULSE_PROPERTY = '--voice-pulse';

/** Below this, the published level has reached its target and there is nothing
 *  left to animate until something else changes. */
const SETTLED = 0.002;

/**
 * Publishes "how loud is the voice right now" as a single CSS custom property,
 * fifteen times a second — and only while that number is actually moving.
 *
 * This is the ONLY per-frame work the voice visuals do. What it drives — a
 * scale and an opacity — are compositor properties, so the browser animates
 * them without repainting and keeps animating them even when the main thread is
 * busy. That last part is the point: when the renderer was saturated, the old
 * canvas loop visibly stopped turning.
 *
 * The loop PARKS once the level has settled and no analyser is feeding it, and
 * is woken by a phase or analyser change. Idle Voice Mode therefore costs
 * nothing at all, and a headless renderer (no analyser, no compositor) does not
 * spin a frame loop forever.
 */
export function useVoicePulse({
  phase,
  inputAnalyser,
  outputAnalyser,
}: {
  readonly phase: VoiceCallPhase;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
}): RefObject<HTMLDivElement> {
  const pulseRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const phaseRef = useRef(phase);
  const inputRef = useRef(inputAnalyser);
  const outputRef = useRef(outputAnalyser);
  const wakeRef = useRef<(() => void) | null>(null);
  phaseRef.current = phase;
  inputRef.current = inputAnalyser;
  outputRef.current = outputAnalyser;

  useEffect(() => {
    const element = pulseRef.current;
    if (!element) return;

    const buffers = createAnalyserLevelBuffers();
    let frame = 0;
    let running = false;
    let cancelled = false;
    let energy = 0;
    let lastTick: number | null = null;

    const source = (): unknown => (
      phaseRef.current === 'speaking'
        ? outputRef.current
        : phaseRef.current === 'listening'
          ? inputRef.current
          : null
    );
    const publish = (): void => {
      element.style.setProperty(VOICE_PULSE_PROPERTY, energy.toFixed(3));
    };

    const tick = (timestamp: number): void => {
      if (cancelled) return;
      if (!shouldPaintVoiceFrame(lastTick, timestamp, VOICE_PULSE_FRAME_MS)) {
        frame = requestAnimationFrame(tick);
        return;
      }
      lastTick = timestamp;
      const live = source();
      const target = resolveVoiceEnergy(phaseRef.current, readAnalyserLevel(live, buffers));
      energy += (target - energy) * 0.3;
      publish();
      // A live analyser always has a next sample; without one the level is
      // converging on a constant, so once it arrives there is nothing to do.
      if (live === null && Math.abs(target - energy) < SETTLED) {
        energy = target;
        publish();
        running = false;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const wake = (): void => {
      if (cancelled || running || reducedMotion) return;
      running = true;
      lastTick = null;
      frame = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    if (reducedMotion) {
      energy = resolveVoiceEnergy(phaseRef.current, 0);
      publish();
      return () => {
        cancelled = true;
        if (wakeRef.current === wake) wakeRef.current = null;
      };
    }

    const onVisibility = (): void => {
      cancelAnimationFrame(frame);
      running = false;
      if (document.visibilityState !== 'hidden') wake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    wake();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
      if (wakeRef.current === wake) wakeRef.current = null;
    };
  }, [reducedMotion]);

  // A new phase or a freshly attached analyser is exactly when a parked loop
  // has something to say again.
  useEffect(() => {
    wakeRef.current?.();
  }, [phase, inputAnalyser, outputAnalyser]);

  return pulseRef;
}

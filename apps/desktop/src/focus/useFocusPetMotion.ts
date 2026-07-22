import { useEffect, useRef, type RefObject } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { useReducedMotion } from '../shell/useReducedMotion';
import { shouldNudgeFocusPet } from './focus-pet-state';

/** Runs one restrained attention gesture when Moxxy enters a work phase. */
export function useFocusPetMotion(phase: VoiceCallPhase): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement | null>(null);
  const previousPhase = useRef(phase);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = phase;
    if (reducedMotion || !shouldNudgeFocusPet(previous, phase)) return;

    const element = ref.current;
    if (!element || typeof element.animate !== 'function') return;
    const lift = phase === 'waiting-for-input' ? -6 : -4;
    const animation = element.animate(
      [
        { transform: 'translateY(0) rotate(0deg) scale(1)' },
        { transform: `translateY(${lift}px) rotate(1.2deg) scale(1.025)`, offset: 0.42 },
        { transform: 'translateY(0) rotate(0deg) scale(1)' },
      ],
      { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
    return () => animation.cancel();
  }, [phase, reducedMotion]);

  return ref;
}

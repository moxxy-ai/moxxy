import { useEffect, useState } from 'react';
import { isMacPlatform } from './chordLabel';

/**
 * How long the modifier is held by itself before the shortcuts show. Longer
 * than the pause inside a chord someone already knows, so they never flash on
 * the way to ⌘C.
 */
export const HINT_HOLD_MS = 400;

/** The key every `mod+` chord starts with on this kind of keyboard. */
export function modifierKey(mac: boolean): 'Meta' | 'Control' {
  return mac ? 'Meta' : 'Control';
}

/**
 * True while the modifier has been held by itself for a moment: the gesture of
 * someone asking what they can press. Any other key, a click, a scroll or
 * leaving the window ends it, so it is never in the way of a chord.
 */
export function useModifierHeld(mac: boolean = isMacPlatform()): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const key = modifierKey(mac);
    let waiting: ReturnType<typeof setTimeout> | null = null;

    const letGo = (): void => {
      if (waiting !== null) clearTimeout(waiting);
      waiting = null;
      setHeld(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      // Windows reports AltGr as Control followed by AltGraph: the second key calls it off.
      if (event.key !== key || event.altKey || event.shiftKey) {
        letGo();
        return;
      }
      if (event.repeat || waiting !== null) return;
      waiting = setTimeout(() => setHeld(true), HINT_HOLD_MS);
    };

    // Capture: a handler that stops the event must not leave the shortcuts up.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', letGo, true);
    window.addEventListener('mousedown', letGo, true);
    window.addEventListener('wheel', letGo, { capture: true, passive: true });
    window.addEventListener('blur', letGo);
    return () => {
      letGo();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', letGo, true);
      window.removeEventListener('mousedown', letGo, true);
      window.removeEventListener('wheel', letGo, true);
      window.removeEventListener('blur', letGo);
    };
  }, [mac]);

  return held;
}

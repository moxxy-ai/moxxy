import { useLayoutEffect, useState } from 'react';
import { chordLabel } from './chordLabel';
import { hintAnchor } from './hint-anchor';
import { hotkeys } from './registry';
import { useModifierHeld } from './useModifierHeld';

export interface HotkeyHint {
  /** The chord as this keyboard writes it. */
  readonly label: string;
  readonly left: number;
  readonly top: number;
}

/** A control hidden by its own styles or an ancestor's has nothing to write on. */
function isShown(control: HTMLElement): boolean {
  return typeof control.checkVisibility === 'function' ? control.checkVisibility({ visibilityProperty: true }) : true;
}

/** One hint for each control on screen that names a shortcut the keymap has bound and live. */
function collectHints(): ReadonlyArray<HotkeyHint> {
  const chords = new Map(hotkeys.list().filter((binding) => !binding.disabled).map((binding) => [binding.id, binding.chord]));
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const hints: HotkeyHint[] = [];
  for (const control of document.querySelectorAll<HTMLElement>('[data-hotkey]')) {
    const chord = chords.get(control.dataset.hotkey ?? '');
    if (chord === undefined || !isShown(control)) continue;
    const at = hintAnchor(control.getBoundingClientRect(), viewport);
    if (at !== null) hints.push({ label: chordLabel(chord), ...at });
  }
  return hints;
}

const NONE: ReadonlyArray<HotkeyHint> = [];

/**
 * The shortcuts to write on the controls while the modifier is held. A control
 * opts in with `data-hotkey="<binding id>"`; the chord comes from the keymap,
 * so a hint cannot name a shortcut that is not bound.
 */
export function useHotkeyHints(): ReadonlyArray<HotkeyHint> {
  const held = useModifierHeld();
  const [hints, setHints] = useState(NONE);
  // Measured once the controls are laid out, before the hints are painted.
  useLayoutEffect(() => setHints(held ? collectHints() : NONE), [held]);
  return hints;
}

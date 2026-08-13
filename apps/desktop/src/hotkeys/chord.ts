/**
 * Chord parsing / matching / rendering. Pure and DOM-free so the keymap can be
 * tested without a window, and so the same spec string drives both the listener
 * and the shortcut help sheet (one source of truth: a shortcut that is listed
 * but not bound, or bound but not listed, is the classic keymap bug).
 *
 * `mod` is ⌘ on macOS and Ctrl elsewhere. Matching accepts either, exactly as
 * the app's original hand-rolled Cmd/Ctrl+B handler did, so a bound chord works
 * on whichever key the user's platform trained them to reach for.
 */

export interface Chord {
  /** Normalized `KeyboardEvent.key`, lowercased. */
  readonly key: string;
  readonly mod: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface KeyLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const MODIFIERS = new Set(['mod', 'alt', 'shift']);

export function parseChord(spec: string): Chord {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase());
  // Every malformed spec throws. A hotkey that parses but can never match is
  // the worst failure mode here: it looks bound, it lists in the help sheet,
  // and it silently does nothing.
  if (parts.some((p) => p.length === 0)) {
    throw new Error(`hotkey spec has an empty segment: "${spec}"`);
  }
  const key = parts[parts.length - 1]!;
  if (MODIFIERS.has(key)) {
    throw new Error(`hotkey spec "${spec}" ends in a modifier, so it has no key`);
  }
  const mods = new Set(parts.slice(0, -1));
  for (const m of mods) {
    if (!MODIFIERS.has(m)) {
      throw new Error(`unknown hotkey modifier "${m}" in "${spec}" (use mod/alt/shift)`);
    }
  }
  return { key, mod: mods.has('mod'), alt: mods.has('alt'), shift: mods.has('shift') };
}

export function matchesChord(event: KeyLike, chord: Chord): boolean {
  if (event.key.toLowerCase() !== chord.key) return false;
  // Exact modifier match in both directions: without this, ⌘⇧N would also fire
  // the ⌘N binding and create a session every time the user meant a workspace.
  if (chord.mod !== (event.metaKey || event.ctrlKey)) return false;
  if (chord.alt !== event.altKey) return false;
  if (chord.shift !== event.shiftKey) return false;
  return true;
}

/** A chord with no modifier (Escape, ?) is unsafe to fire while the user is
 *  typing; a modified one is the whole point of a global shortcut. */
export function defaultAllowInEditable(chord: Chord): boolean {
  return chord.mod || chord.alt;
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  mod: '⌘',
  alt: '⌥',
  shift: '⇧',
};

const KEY_LABELS: Readonly<Record<string, string>> = {
  escape: 'Esc',
  enter: '↵',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
};

/** Human-readable chord for the help sheet and tooltips. */
export function formatChord(chord: Chord, isMac: boolean): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(isMac ? MAC_SYMBOLS.mod! : 'Ctrl');
  if (chord.alt) parts.push(isMac ? MAC_SYMBOLS.alt! : 'Alt');
  if (chord.shift) parts.push(isMac ? MAC_SYMBOLS.shift! : 'Shift');
  const key = KEY_LABELS[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : capitalize(chord.key));
  parts.push(key);
  return isMac ? parts.join('') : parts.join('+');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** True when the key event came from a text-entry surface. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

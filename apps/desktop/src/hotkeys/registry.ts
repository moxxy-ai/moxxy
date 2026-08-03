import {
  defaultAllowInEditable,
  isEditableTarget,
  matchesChord,
  parseChord,
  type Chord,
  type KeyLike,
} from './chord';

/**
 * The single keymap. Components register what they can do; one window listener
 * dispatches. Keeping the bindings in a registry rather than in a dozen local
 * `keydown` effects is what makes the help sheet truthful and what lets an
 * overlay shadow a global chord without the two racing.
 */

export interface HotkeyBinding {
  /** Stable id, also the React key in the help sheet. */
  readonly id: string;
  /** e.g. `mod+k`, `mod+shift+n`. */
  readonly chord: string;
  /** Imperative, sentence-case: "Open the command palette". */
  readonly label: string;
  /** Help-sheet grouping. */
  readonly group: string;
  readonly run: () => void;
  /** Registered but inert (e.g. no session yet), still listed, shown dimmed. */
  readonly disabled?: boolean;
  /** Override the modifier-based default (see `defaultAllowInEditable`). */
  readonly allowInEditable?: boolean;
  /** Higher wins when two bindings share a chord. Overlays use 100. */
  readonly priority?: number;
  /** Hide from the help sheet (for internal/duplicate aliases). */
  readonly hidden?: boolean;
}

interface Entry {
  readonly binding: HotkeyBinding;
  readonly parsed: Chord;
  readonly order: number;
}

export class HotkeyRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private counter = 0;
  private snapshot: ReadonlyArray<HotkeyBinding> | null = null;

  register(binding: HotkeyBinding): () => void {
    const parsed = parseChord(binding.chord);
    // Re-registering the same id replaces it (a component re-rendering with a
    // new closure must not leave the previous handler live).
    this.entries.set(binding.id, { binding, parsed, order: this.counter++ });
    this.emit();
    return () => {
      const current = this.entries.get(binding.id);
      if (current?.binding === binding) {
        this.entries.delete(binding.id);
        this.emit();
      }
    };
  }

  /**
   * Every binding, ordered for display: by group, then registration order.
   *
   * The result is memoized until the next change because `useSyncExternalStore`
   * treats a fresh array as new state, so recomputing per call would re-render the
   * help sheet forever.
   */
  list(): ReadonlyArray<HotkeyBinding> {
    if (!this.snapshot) {
      this.snapshot = [...this.entries.values()]
        .sort((a, b) => a.binding.group.localeCompare(b.binding.group) || a.order - b.order)
        .map((e) => e.binding);
    }
    return this.snapshot;
  }

  /**
   * Resolve a key event to its binding. Returns null when nothing matches, the
   * match is disabled, or the event came from a text field the binding is not
   * cleared for. Pure: the caller decides about `preventDefault`.
   */
  resolve(event: KeyLike, target: EventTarget | null): HotkeyBinding | null {
    const editable = isEditableTarget(target);
    let best: Entry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.binding.disabled) continue;
      if (!matchesChord(event, entry.parsed)) continue;
      if (editable && !(entry.binding.allowInEditable ?? defaultAllowInEditable(entry.parsed))) {
        continue;
      }
      const bestPriority = best?.binding.priority ?? 0;
      const priority = entry.binding.priority ?? 0;
      // Later registration wins ties, so a freshly-opened overlay claims the
      // chord from an equal-priority binding that was already mounted.
      if (!best || priority > bestPriority || (priority === bestPriority && entry.order > best.order)) {
        best = entry;
      }
    }
    return best?.binding ?? null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    this.snapshot = null;
    for (const fn of this.listeners) fn();
  }
}

/** The app-wide registry. One per renderer. */
export const hotkeys = new HotkeyRegistry();

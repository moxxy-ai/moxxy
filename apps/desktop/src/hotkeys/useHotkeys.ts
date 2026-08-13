import { useEffect, useRef, useSyncExternalStore } from 'react';
import { hotkeys, type HotkeyBinding } from './registry';

/**
 * Register one binding for the lifetime of the calling component.
 *
 * `run` is held in a ref so an inline arrow doesn't re-register on every
 * render. The binding stays stable while always calling the latest closure.
 */
export function useHotkey(
  binding: Omit<HotkeyBinding, 'run'> & { readonly run: () => void },
): void {
  const run = useRef(binding.run);
  run.current = binding.run;
  const { id, chord, label, group, disabled, allowInEditable, priority, hidden } = binding;
  useEffect(() => {
    return hotkeys.register({
      id,
      chord,
      label,
      group,
      run: () => run.current(),
      ...(disabled === undefined ? {} : { disabled }),
      ...(allowInEditable === undefined ? {} : { allowInEditable }),
      ...(priority === undefined ? {} : { priority }),
      ...(hidden === undefined ? {} : { hidden }),
    });
  }, [id, chord, label, group, disabled, allowInEditable, priority, hidden]);
}

/** Register several bindings at once. The array may change identity freely. */
export function useHotkeyList(bindings: ReadonlyArray<HotkeyBinding>): void {
  const latest = useRef(bindings);
  latest.current = bindings;
  // Re-arm only when the SHAPE changes (ids/chords/disabled), not when a
  // handler closure is recreated by a parent re-render.
  const shape = bindings
    .map((b) => `${b.id}:${b.chord}:${b.disabled ? 0 : 1}:${b.priority ?? 0}`)
    .join('|');
  useEffect(() => {
    const disposers = latest.current.map((binding, index) =>
      hotkeys.register({
        ...binding,
        run: () => latest.current[index]?.run(),
      }),
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [shape]);
}

/**
 * Install the single window-level dispatcher. Called once, by the shell.
 *
 * BUBBLE phase, and `defaultPrevented` events are skipped: any component that
 * already handled the key (the composer's Enter, a modal's Escape, the command
 * palette's arrows) wins without having to know the global keymap exists.
 */
export function useHotkeyDispatcher(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const binding = hotkeys.resolve(e, e.target);
      if (!binding) return;
      e.preventDefault();
      binding.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Reactive view of the keymap, for the help sheet. */
export function useHotkeyList$(): ReadonlyArray<HotkeyBinding> {
  return useSyncExternalStore(
    (fn) => hotkeys.subscribe(fn),
    () => hotkeys.list(),
    () => hotkeys.list(),
  );
}

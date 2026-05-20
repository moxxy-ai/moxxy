import type React from 'react';
import { useInput } from 'ink';

export interface GlobalHotkeysOptions {
  busy: boolean;
  overlayOpen: boolean;
  turnControllerRef: React.MutableRefObject<AbortController | null>;
  setSystemNotice: (msg: string | null) => void;
}

/**
 * The only TUI-wide hotkey that goes through Ink's `useInput`: Esc /
 * Ctrl+C while busy → cancel the current turn. Ink can receive these
 * because they fire BEFORE PromptInput's data listener attaches (Esc
 * cancel during a turn only matters when the turn is in flight; the
 * input may or may not be present).
 *
 * Every other "always-on" hotkey (Ctrl+O for live-block expand, Ctrl+T
 * to force-send a queued message, Ctrl+B to drop one) is routed
 * through `PromptInput.commandHotkeys` instead — once PromptInput owns
 * stdin, Ink's `useInput` stops receiving keystrokes.
 */
export function useGlobalHotkeys(opts: GlobalHotkeysOptions): void {
  useInput(
    (input, key) => {
      if (!opts.busy) return;
      if (opts.overlayOpen) return;
      const isCancel = key.escape || (key.ctrl && input === 'c');
      if (isCancel) {
        const ctrl = opts.turnControllerRef.current;
        if (ctrl && !ctrl.signal.aborted) {
          ctrl.abort('user cancel');
          opts.setSystemNotice('turn cancelled');
        }
      }
    },
    { isActive: opts.busy && !opts.overlayOpen },
  );
}

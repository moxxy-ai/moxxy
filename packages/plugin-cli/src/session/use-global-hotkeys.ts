import type React from 'react';
import { useInput } from 'ink';

export interface GlobalHotkeysOptions {
  busy: boolean;
  overlayOpen: boolean;
  turnControllerRef: React.MutableRefObject<AbortController | null>;
  setSystemNotice: (msg: string | null) => void;
  setExpandToolOutputs: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Wires the TUI-wide hotkeys:
 *   - Esc / Ctrl+C while busy and no overlay open → cancel the turn
 *   - Ctrl+O (always) → toggle global live-tools-block expand/collapse
 *
 * The Esc handler is gated on "no overlay is intercepting Esc" so the
 * cancel doesn't fire alongside the modal's own close handler.
 */
export function useGlobalHotkeys(opts: GlobalHotkeysOptions): void {
  useInput(
    (input, key) => {
      if (!opts.busy) return;
      if (opts.overlayOpen) return; // let the modal's own Esc handler run alone
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

  // Always-on Ctrl+O handler: toggle global live-tools-block expand/collapse.
  // Lives outside the busy gate so the keystroke works while typing AND
  // mid-turn. PromptInput's useInput gates printable input on !key.ctrl
  // so this passes through cleanly.
  useInput((input, key) => {
    if (key.ctrl && input === 'o') {
      opts.setExpandToolOutputs((e) => {
        const next = !e;
        opts.setSystemNotice(
          next
            ? 'tool blocks expanded — Ctrl+O again to collapse'
            : 'tool blocks collapsed — Ctrl+O again to expand',
        );
        return next;
      });
    }
  });
}

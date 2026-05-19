import type React from 'react';
import { useInput } from 'ink';

export interface GlobalHotkeysOptions {
  busy: boolean;
  overlayOpen: boolean;
  turnControllerRef: React.MutableRefObject<AbortController | null>;
  setSystemNotice: (msg: string | null) => void;
  setExpandSkills: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Wires the two TUI-wide hotkeys:
 *   - Esc / Ctrl+C while busy and no overlay open → cancel the turn
 *   - Ctrl+B (always) → toggle global skill-scope expand/collapse
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

  // Always-on Ctrl+B handler: toggle global skill-scope expand/collapse.
  // Lives outside the busy gate so the hotkey works both while typing
  // and while a turn is in flight. PromptInput's useInput doesn't
  // intercept Ctrl+B (it gates printable input on !key.ctrl), so the
  // keystroke passes through cleanly.
  useInput((input, key) => {
    if (key.ctrl && input === 'b') {
      opts.setExpandSkills((e) => {
        const next = !e;
        opts.setSystemNotice(
          next
            ? 'skill scopes expanded — Ctrl+B again to collapse'
            : 'skill scopes collapsed — Ctrl+B again to expand',
        );
        return next;
      });
    }
  });
}

import type React from 'react';
import { useInput } from 'ink';

export interface GlobalHotkeysOptions {
  busy: boolean;
  overlayOpen: boolean;
  turnControllerRef: React.MutableRefObject<AbortController | null>;
  setSystemNotice: (msg: string | null) => void;
  setExpandToolOutputs: React.Dispatch<React.SetStateAction<boolean>>;
  forceSendFirst: () => boolean;
  dropFirst: () => boolean;
}

/**
 * Wires the TUI-wide hotkeys:
 *   - Esc / Ctrl+C while busy and no overlay open → cancel the turn
 *   - Ctrl+O (always) → toggle global live-tools-block expand/collapse
 *   - Ctrl+J (always) → force-send the first queued message (runs alone
 *     after the current turn ends, bypassing the auto-merge)
 *   - Ctrl+K (always) → drop the first queued message
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
      return;
    }
    if (key.ctrl && input === 'j') {
      const moved = opts.forceSendFirst();
      opts.setSystemNotice(
        moved
          ? 'queue: first message will run next, by itself'
          : 'queue: nothing queued to force-send',
      );
      return;
    }
    if (key.ctrl && input === 'k') {
      const dropped = opts.dropFirst();
      opts.setSystemNotice(
        dropped ? 'queue: dropped the first queued message' : 'queue: nothing to drop',
      );
      return;
    }
  });
}

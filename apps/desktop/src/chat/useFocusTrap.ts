/**
 * Focus management for bespoke (non-shared-Modal) dialogs/sheets in the chat
 * surface — the security-critical AskSheet permission gate and the GoalModal.
 *
 * On mount: remember the element that had focus, then move focus into the
 * dialog (preferring an explicit initial target). While mounted: trap Tab so
 * keyboard/AT users can't reach the disabled composer or transcript behind the
 * dialog, and treat Escape as a cancel. On unmount: restore focus to whatever
 * was focused at open so the user isn't dropped back to <body>.
 *
 * Kept dependency-free and local to the renderer so AskSheet/GoalModal don't
 * each re-implement (divergent) trap logic.
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

export interface FocusTrapOptions {
  /** Container that owns the dialog's focusable elements. */
  readonly containerRef: RefObject<HTMLElement>;
  /** Optional element to focus on mount (falls back to first focusable). */
  readonly initialFocusRef?: RefObject<HTMLElement>;
  /** Called when Escape is pressed inside the trap. */
  readonly onEscape?: () => void;
}

export function useFocusTrap({ containerRef, initialFocusRef, onEscape }: FocusTrapOptions): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus in on mount. Defer one frame so refs/children are laid out.
    const focusTarget =
      initialFocusRef?.current ?? focusableWithin(container)[0] ?? container;
    focusTarget.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeInside = container.contains(document.activeElement);
      if (e.shiftKey) {
        if (!activeInside || document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!activeInside || document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Restore focus to the opener if it's still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // Re-bind when the focus target / escape handler identity changes (e.g. the
    // ApprovalSheet swapping to its text sub-step), so focus follows the step.
  }, [containerRef, initialFocusRef, onEscape]);
}

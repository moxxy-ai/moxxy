import { createPortal } from 'react-dom';
import { useHotkeyHints } from './useHotkeyHints';

/**
 * Writes each control's shortcut on it while the modifier is held. Mounted
 * once for the window, on the document body, so no panel clips it. The
 * controls carry their own names; this is for the eye only.
 */
export function HotkeyHints(): JSX.Element | null {
  const hints = useHotkeyHints();
  if (hints.length === 0) return null;
  return createPortal(
    <div aria-hidden="true">
      {hints.map((hint, index) => (
        <kbd
          // The same control set, in document order, for as long as they show.
          key={index}
          className="hotkey-hint"
          data-testid="hotkey-hint"
          style={{ left: hint.left, top: hint.top }}
        >
          {hint.label}
        </kbd>
      ))}
    </div>,
    document.body,
  );
}

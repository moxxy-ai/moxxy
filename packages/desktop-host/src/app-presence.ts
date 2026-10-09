import type { AppPresence } from '@moxxy/desktop-ipc-contract';

/** The part of a window the reading needs. */
export interface PresenceWindow {
  isDestroyed(): boolean;
  isFocused(): boolean;
}

function hasKeyboard(window: PresenceWindow | null): boolean {
  return window !== null && !window.isDestroyed() && window.isFocused();
}

/** Which of the app's windows has the keyboard, and whether the Mini Chat is open. */
export function appPresence({
  main,
  widget,
  others,
}: {
  readonly main: PresenceWindow | null;
  /** The Mini Chat widget. */
  readonly widget: PresenceWindow | null;
  /** Every other window of the app. */
  readonly others: ReadonlyArray<PresenceWindow>;
}): AppPresence {
  const focused = hasKeyboard(main)
    ? 'main'
    : hasKeyboard(widget)
      ? 'widget'
      : others.some(hasKeyboard)
        ? 'other'
        : null;
  return { focused, widgetOpen: widget !== null && !widget.isDestroyed() };
}

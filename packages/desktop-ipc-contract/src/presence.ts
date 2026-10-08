// ---------- Which of the app's windows has the keyboard --------------------

/**
 * Where the app stands on the person's screen, as only the main process knows
 * it. The renderer reads it to tell a chat that is being read from one that
 * finished, or stopped to ask, while the person was elsewhere.
 */
export interface AppPresence {
  /** The window with the keyboard: the main one, the Mini Chat widget, another
   *  window of the app (a sign-in one), or none while the app is in the
   *  background. */
  readonly focused: 'main' | 'widget' | 'other' | null;
  /** The Mini Chat widget is open; it shows the active chat. */
  readonly widgetOpen: boolean;
}

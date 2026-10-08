/** One system notification about a chat. */
export interface Banner {
  readonly title: string;
  readonly body: string;
  /** A newer banner under the same tag replaces the older one. */
  readonly tag: string;
  readonly onOpen: () => void;
}

/**
 * Hands a banner to the system's notification centre. Silent: the chime is the
 * app's one sound, with its own switch. Does nothing where the system has no
 * notification centre or refuses the app.
 */
export function showBanner({ title, body, tag, onOpen }: Banner): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const shown = new Notification(title, { body, tag, silent: true });
  shown.onclick = () => {
    shown.close();
    onOpen();
  };
}

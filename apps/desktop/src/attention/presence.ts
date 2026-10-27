import { api } from '@moxxy/client-core';
import type { AppPresence } from '@moxxy/desktop-ipc-contract';

/** Assumed when the main process cannot be asked: nothing rings for the chat on screen, no banner shows. */
const IN_FRONT: AppPresence = { focused: 'main', widgetOpen: false };

/** Only the main process knows which of the app's windows has the keyboard. */
export function readPresence(): Promise<AppPresence> {
  return api()
    .invoke('window.presence')
    .catch(() => IN_FRONT);
}

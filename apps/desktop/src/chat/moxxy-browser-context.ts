import { createContext, useContext } from 'react';

/**
 * Whether the window the chat is drawn in has the Moxxy browser beside it.
 * The main window does; the Mini Chat does not, so its links open in the
 * default browser and never pull the main window up.
 */
export const MoxxyBrowserContext = createContext<boolean>(true);

export function useHasMoxxyBrowser(): boolean {
  return useContext(MoxxyBrowserContext);
}

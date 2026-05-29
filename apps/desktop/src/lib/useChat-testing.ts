/**
 * Test-only shim: re-exports the pure reducer + initial state from
 * `useChat.ts` so tests can exercise the state machine without a
 * React render. The reducer lives module-private inside useChat.ts
 * to keep its surface tight — this re-export is the seam.
 */

import * as mod from './useChat';
import type { ChatAction, ChatState } from './useChat';

interface Internals {
  initial: () => ChatState;
  apply: (state: ChatState, action: ChatAction) => ChatState;
}

export const reducerForTest: Internals = ((): Internals => {
  const m = mod as unknown as { __reducerForTest?: Internals };
  if (!m.__reducerForTest) {
    throw new Error(
      'useChat module did not expose __reducerForTest — this is a test wiring bug.',
    );
  }
  return m.__reducerForTest;
})();

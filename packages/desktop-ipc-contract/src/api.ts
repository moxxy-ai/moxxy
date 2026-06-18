import type { IpcCommandName, IpcCommands } from './commands.js';
import type { IpcEvents } from './events.js';

// ---------- Shape the preload exposes on `window.moxxy` -------------------

export type SubscribeFn = <K extends keyof IpcEvents>(
  channel: K,
  handler: (payload: IpcEvents[K]) => void,
) => () => void;

export type InvokeFn = <K extends IpcCommandName>(
  command: K,
  ...args: Parameters<IpcCommands[K]>
) => ReturnType<IpcCommands[K]>;

export interface MoxxyApi {
  invoke: InvokeFn;
  subscribe: SubscribeFn;
}

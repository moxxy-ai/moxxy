/**
 * Shared IPC contract — every channel name and payload shape used
 * across the Electron main / preload / renderer boundary lives here.
 * The preload exposes `window.moxxy` whose surface is generated from
 * these types; the renderer uses `window.moxxy` exclusively (no raw
 * `electron.ipcRenderer.invoke` calls leak through).
 *
 * Keeping this in one file means a new feature is one shape addition
 * here + a main-process handler + a renderer call — no string typos
 * across three places.
 */

import type { MoxxyEvent } from '@moxxy/sdk';

// ---------- Connection lifecycle -------------------------------------------

/**
 * State machine the main process broadcasts as it tries to reach a
 * working moxxy runner. The renderer reads the latest phase and
 * renders the right surface.
 */
export type ConnectionPhase =
  | { phase: 'idle' }
  | { phase: 'resolving-cli' }
  | { phase: 'cli-missing'; hint: string }
  | { phase: 'spawning'; cliPath: string; socket: string; pid?: number }
  | { phase: 'adopting'; socket: string }
  | { phase: 'attaching'; socket: string }
  | {
      phase: 'connected';
      socket: string;
      sessionId: string;
      activeProvider: string | null;
      activeMode: string | null;
    }
  | {
      phase: 'reconnecting';
      reason: string;
      attempt: number;
    }
  | { phase: 'failed'; error: string; hint?: string };

export interface ConnectionSnapshot {
  phase: ConnectionPhase;
  cliPath: string | null;
  attempts: number;
  log: ReadonlyArray<{ stream: 'stdout' | 'stderr'; line: string }>;
}

// ---------- Onboarding -----------------------------------------------------

/**
 * Provider-key + config state. The renderer flips to the init
 * wizard whenever `needsSetup` is true after a successful connect.
 */
export interface OnboardingStatus {
  cliInstalled: boolean;
  cliPath: string | null;
  hasProvider: boolean;
  /** ProviderName from `~/.moxxy/preferences.json`. */
  activeProvider: string | null;
}

/**
 * Node.js detection snapshot — drives the first onboarding step
 * (we can't install or run moxxy without Node).
 */
export interface NodeProbe {
  installed: boolean;
  version: string | null;
  bin: string | null;
}

/** One line of streamed install output. */
export interface InstallProgressLine {
  line: string;
}

// ---------- Chat -----------------------------------------------------------

export interface RunTurnArgs {
  prompt: string;
  model?: string;
}

export interface RunTurnResult {
  turnId: string;
}

// ---------- Events the renderer subscribes to ------------------------------

/**
 * Channel names. Centralized so a typo is caught at the type level
 * (the preload's `subscribe(channel, handler)` is generic over this
 * map).
 */
export interface IpcEvents {
  'connection.changed': ConnectionPhase;
  'runner.event': MoxxyEvent;
  'runner.turn.complete': { turnId: string; error: string | null };
  'runner.info.changed': unknown;
  /** Streamed during `onboarding.installMoxxyCli`. One event per
   *  stdout/stderr line; the invoke() also returns the final exit
   *  code so callers can short-circuit on success. */
  'onboarding.install.progress': string;
}

// ---------- Invokable commands (renderer → main) --------------------------

/**
 * Every invokable IPC command the renderer can call. The preload
 * surface is built mechanically from this; misnaming a command in the
 * renderer is a type error rather than a silent runtime failure.
 */
export interface IpcCommands {
  /** Returns the latest snapshot. Use alongside `connection.changed`
   *  events to handle late-mount races. */
  'connection.snapshot': () => Promise<ConnectionSnapshot>;
  /** Kick the supervisor out of failed / reconnecting back into the
   *  resolution loop. */
  'connection.retry': () => Promise<void>;

  'onboarding.status': () => Promise<OnboardingStatus>;
  /** Probe Node.js — used by the first wizard step before we offer
   *  the install. */
  'onboarding.probeNode': () => Promise<NodeProbe>;
  /** Run `npm install -g @moxxy/cli`. Streams progress via
   *  `onboarding.install.progress`. Returns the exit code (0 = ok). */
  'onboarding.installMoxxyCli': () => Promise<number>;
  /** Open a URL in the user's default browser. Used for the Node.js
   *  install fallback (we never pretend to install Node ourselves). */
  'onboarding.openExternal': (args: { url: string }) => Promise<void>;
  /** Run `moxxy vault set <NAME>_API_KEY` with the given secret piped
   *  on stdin, then call `provider.setActive` on the running session
   *  so the next turn picks it up without a relaunch. */
  'onboarding.saveProviderKey': (args: { provider: string; secret: string }) => Promise<void>;

  /** Returns the runner's SessionInfo snapshot. */
  'session.info': () => Promise<unknown | null>;
  /** Issue a new turn. Events stream back via 'runner.event'. */
  'session.runTurn': (args: RunTurnArgs) => Promise<RunTurnResult>;
  /** Abort the named turn. Best-effort. */
  'session.abortTurn': (args: { turnId: string }) => Promise<void>;
  /** Switch the active provider. The vault must already hold the
   *  matching credential. */
  'session.setProvider': (args: { provider: string }) => Promise<void>;
  /** Switch the active mode. */
  'session.setMode': (args: { mode: string }) => Promise<void>;
}

/** Names of every command, derived. */
export type IpcCommandName = keyof IpcCommands;

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

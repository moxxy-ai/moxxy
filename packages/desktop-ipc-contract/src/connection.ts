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
  | { phase: 'failed'; error: string; hint?: string }
  /**
   * Terminal: the runner this app can reach speaks an incompatible protocol
   * and respawning won't fix it (the bundled CLI is pinned), so we STOP
   * retrying instead of looping "Reconnecting…" forever. `serverVersion` /
   * `clientVersion` are the two protocol versions, for the diagnostics
   * readout; `hint` is the actionable user-facing instruction. Surfaced after
   * one failed recovery attempt — see RunnerSupervisor.
   */
  | {
      phase: 'protocol-incompatible';
      serverVersion: number | null;
      clientVersion: number | null;
      detail: string;
      hint: string;
    };

export interface ConnectionSnapshot {
  phase: ConnectionPhase;
  cliPath: string | null;
  attempts: number;
  log: ReadonlyArray<{ stream: 'stdout' | 'stderr'; line: string }>;
}

/** The part of a `@discordjs/voice` connection the watch needs. */
export interface WatchedConnection {
  readonly state: { readonly status: string };
  on(event: 'stateChange', listener: (before: { status: string }, after: { status: string }) => void): unknown;
  off(event: 'stateChange', listener: (before: { status: string }, after: { status: string }) => void): unknown;
  rejoin(): boolean;
  destroy(): void;
}

export interface WatchOptions {
  /** How long the connection may be down before the watch acts. */
  readonly graceMs: number;
  /** Every change of the connection's state, for the logs. */
  readonly onChange?: (from: string, to: string) => void;
}

/**
 * Keeps a call's voice connection from dying quietly. Discord drops voice
 * connections now and then; one that does not come back within the grace
 * period is rejoined once, and closed after another — which ends the call
 * (the owner is told) instead of leaving a bot in the channel that hears
 * nothing. Returns a stop function.
 */
export function watchVoiceConnection(conn: WatchedConnection, opts: WatchOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejoined = false;
  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const expire = (): void => {
    timer = null;
    if (!rejoined) {
      rejoined = true;
      conn.rejoin();
      timer = setTimeout(expire, opts.graceMs);
      return;
    }
    conn.destroy();
  };
  const onState = (before: { status: string }, after: { status: string }): void => {
    opts.onChange?.(before.status, after.status);
    if (after.status === 'ready' || after.status === 'destroyed') {
      clear();
      rejoined = false;
      return;
    }
    timer ??= setTimeout(expire, opts.graceMs);
  };
  conn.on('stateChange', onState);
  return () => {
    clear();
    conn.off('stateChange', onState);
  };
}

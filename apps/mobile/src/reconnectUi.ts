export interface ReconnectUiInput {
  /** True once the silent-reconnect grace period has elapsed. */
  readonly graceElapsed: boolean;
  /** The bridge's own error, if it reported one (e.g. disconnected). */
  readonly error: string | null;
}

export interface ReconnectUi {
  /** Reveal the hint + "change configuration" affordance instead of just
   *  spinning forever — the escape hatch out of a stale gateway. */
  readonly showEscapeHatch: boolean;
  /** Explanation shown under the spinner: the bridge's own error when it
   *  reported one, otherwise a generic stale-gateway hint. */
  readonly hint: string;
}

const STALE_GATEWAY_HINT =
  "Still trying to reach your Mac. Make sure Moxxy Desktop is open with the gateway enabled — or pair again if it has moved.";

/** Decide what a reconnecting (already-paired) device should show. We keep
 *  spinning silently for a grace period so a healthy reconnect lands cleanly,
 *  but surface a way to re-pair the moment the bridge errors — or once the
 *  grace period elapses — so a stale gateway can't strand the user. */
export function buildReconnectUi({ graceElapsed, error }: ReconnectUiInput): ReconnectUi {
  return {
    showEscapeHatch: graceElapsed || Boolean(error),
    hint: error ?? STALE_GATEWAY_HINT,
  };
}

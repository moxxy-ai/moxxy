/**
 * Trust-on-first-use pairing window — the mechanism behind Slack's pair flow,
 * generic over the candidate shape (Slack: `{ teamId, channelId }`).
 *
 * A pair flow arms the window, then the channel's ingest path `offer`s every
 * verified inbound event's origin. While armed, the first candidate is captured
 * (listeners — the interactive pair flow — are notified and ask the operator to
 * confirm) and CONSUMED, so the very first message just establishes trust
 * rather than driving a turn. Confirmation + persistence stay with the channel
 * (it owns the vault key format); it calls `disarm()` once authorized.
 */
export interface TofuPairingWindowOptions {
  /** Observe a listener throwing (channels log it); never propagates. */
  readonly onListenerError?: (err: unknown) => void;
}

export class TofuPairingWindow<C> {
  private armed = false;
  private readonly listeners = new Set<(candidate: C) => void>();
  private readonly opts: TofuPairingWindowOptions;

  constructor(opts: TofuPairingWindowOptions = {}) {
    this.opts = opts;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  arm(): void {
    this.armed = true;
  }

  disarm(): void {
    this.armed = false;
  }

  /** Subscribe to captured candidates. Returns an unsubscribe function. */
  onCandidate(listener: (candidate: C) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Present a verified inbound origin. While armed, notifies listeners and
   * returns true — the event was consumed by pairing and must NOT also drive a
   * turn. Returns false when no window is armed.
   */
  offer(candidate: C): boolean {
    if (!this.armed) return false;
    for (const listener of this.listeners) {
      try {
        listener(candidate);
      } catch (err) {
        this.opts.onListenerError?.(err);
      }
    }
    return true;
  }
}

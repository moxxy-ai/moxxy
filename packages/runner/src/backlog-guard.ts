/**
 * Decides when a peer that is not reading its outbound frames must be dropped,
 * so one stalled client cannot make the writer buffer every event in memory.
 *
 * "Stalled" means the reader has taken NO bytes for the grace window, not that
 * the backlog is large: a healthy reader receiving one big frame (a history
 * page, an attachment slice) has a large backlog for a moment and keeps
 * draining it. Judging by size alone once dropped exactly that reader the
 * instant the next small event went out, and the desktop reconnected into the
 * same page forever. The hard ceiling still bounds memory outright.
 *
 * Pure: the transport reports its backlog before each send (`check`) and the
 * bytes it handed the socket after it (`recordSent`).
 */
export class OutboundBacklogGuard {
  private stalledSinceMs: number | null = null;
  private sentBytes = 0;
  private drainedAtStallStart = 0;

  constructor(
    private readonly limitBytes: number,
    private readonly graceMs: number,
    private readonly hardLimitBytes: number = limitBytes * 4,
  ) {}

  check(bufferedBytes: number, nowMs: number): 'ok' | 'terminate' {
    if (bufferedBytes > this.hardLimitBytes) return 'terminate';
    if (bufferedBytes <= this.limitBytes) {
      this.stalledSinceMs = null;
      return 'ok';
    }
    const drained = this.sentBytes - bufferedBytes;
    if (this.stalledSinceMs === null || drained > this.drainedAtStallStart) {
      this.stalledSinceMs = nowMs;
      this.drainedAtStallStart = drained;
      return 'ok';
    }
    return nowMs - this.stalledSinceMs >= this.graceMs ? 'terminate' : 'ok';
  }

  recordSent(bytes: number): void {
    this.sentBytes += bytes;
  }
}

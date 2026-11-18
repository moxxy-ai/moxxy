import { setImmediate as yieldToIO } from 'node:timers/promises';
import type { EventLog } from '@moxxy/core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { eventForClient } from '@moxxy/sdk';
import { MAX_OUTBOUND_HARD_BYTES } from './backlog-guard.js';
import type { JsonRpcPeer } from './jsonrpc.js';
import { RunnerNotification, type AttachReplay, type TurnCompleteNotification } from './protocol.js';
import type { Transport } from './transport.js';

/** Give other clients an I/O turn even when every frame fits the socket immediately. */
const EVENTS_PER_BATCH = 256;

/** One recipient's cursor, shared by attach-time replay and subsequent live delivery. */
export class ClientHistory {
  private nextSeq = 0;
  private replaying = false;
  // Only turn endings need a fence. Events themselves always live in the log.
  private readonly completions = new Set<{
    afterSeq: number;
    params: TurnCompleteNotification;
    bytes: number;
  }>();
  private completionBytes = 0;

  constructor(
    private readonly log: EventLog,
    private readonly peer: JsonRpcPeer,
    private readonly transport: Transport,
  ) {}

  get catchingUp(): boolean {
    return this.replaying;
  }

  async attach(replay: AttachReplay, ready: () => void): Promise<void> {
    this.replaying = true;
    const base = this.log.baseSeq;
    const end = base + this.log.length;
    this.nextSeq = replay === 'full' ? base : replay === 'none' ? end : Math.max(base, end - replay.tail);
    this.peer.notify(RunnerNotification.ReplayStart, { fromSeq: this.nextSeq });
    try {
      let batch = 0;
      while (!this.peer.isClosed) {
        const completion = this.completions.values().next().value;
        if (completion && completion.afterSeq <= this.nextSeq) {
          this.completions.delete(completion);
          this.completionBytes -= completion.bytes;
          this.peer.notify(RunnerNotification.TurnComplete, completion.params);
        } else {
          const event = this.log.at(this.nextSeq);
          if (!event) {
            // No await between catching up, taking the info snapshot, replying
            // and switching to live delivery.
            ready();
            return;
          }
          this.sendEvent(eventForClient(event));
        }
        const drain = this.transport.waitForDrain?.();
        if (drain) {
          await drain;
          batch = 0;
        } else if (this.transport.waitForDrain && ++batch >= EVENTS_PER_BATCH) {
          await yieldToIO();
          batch = 0;
        }
      }
    } finally {
      this.replaying = false;
      this.completions.clear();
      this.completionBytes = 0;
    }
  }

  live(event: MoxxyEvent, projected: MoxxyEvent): void {
    if (this.replaying || this.log.at(event.seq) !== event) return;
    // Concurrent appends may reach the broadcast subscriber out of order.
    // The cursor also skips delayed broadcasts of events already replayed.
    while (this.nextSeq <= event.seq && !this.peer.isClosed) {
      const next = this.log.at(this.nextSeq);
      if (!next) return;
      this.sendEvent(next === event ? projected : eventForClient(next));
    }
  }

  reset(): void {
    this.nextSeq = 0;
    this.peer.notify(RunnerNotification.SessionReset, {});
    // The reset supersedes the outstanding prefix all these turns belonged to.
    for (const completion of this.completions) completion.afterSeq = 0;
  }

  turnComplete(params: TurnCompleteNotification): void {
    const end = this.log.baseSeq + this.log.length;
    if (this.replaying && (this.nextSeq < end || this.completions.size > 0)) {
      // Charge for the record as well as its strings so tiny notifications
      // cannot accumulate without bound while a large replay is in flight.
      const bytes = 128 + 2 * (params.turnId.length + (params.error?.length ?? 0));
      if (this.completionBytes + bytes > MAX_OUTBOUND_HARD_BYTES) {
        this.peer.close(new Error('slow reader: pending turn completions exceeded the outbound limit'));
        return;
      }
      this.completionBytes += bytes;
      this.completions.add({ afterSeq: end, params, bytes });
    } else {
      this.peer.notify(RunnerNotification.TurnComplete, params);
    }
  }

  private sendEvent(event: MoxxyEvent): void {
    this.nextSeq++;
    this.peer.notify(RunnerNotification.Event, { event });
  }
}

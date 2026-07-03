import type { MoxxyEvent } from '@moxxy/sdk';

/**
 * Accumulate streamed assistant text from the event log into a single growing
 * snapshot — the minimal plain-text turn renderer for channels without a rich
 * frame format (Slack v1 and future thin adapters). `assistant_chunk` deltas
 * render live; the final `assistant_message` content (which supersedes the
 * streamed deltas for the same turn) wins so the last edit always carries the
 * complete reply.
 */
export class PlainTurnRenderer {
  private streamed = '';
  private finalText: string | null = null;

  /** Returns true when the event changed the snapshot (schedule an edit). */
  accept(event: MoxxyEvent): boolean {
    if (event.type === 'assistant_chunk') {
      this.streamed += event.delta;
      return true;
    }
    if (event.type === 'assistant_message') {
      this.finalText = event.content;
      return true;
    }
    return false;
  }

  snapshot(): string {
    return (this.finalText ?? this.streamed).trim();
  }
}

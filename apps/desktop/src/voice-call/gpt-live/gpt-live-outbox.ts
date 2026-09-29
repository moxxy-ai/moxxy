/**
 * Anything appended to the call while GPT-Live is speaking cuts its answer off
 * mid-sentence, and the model then only remembers the part it got to say
 * (verified live, 2026-09-29). Context and task results therefore wait until
 * the current spoken turn is over; before a reply starts, appends are safe.
 */
export class GptLiveOutbox {
  private speaking = false;
  private held: unknown[] = [];

  /** The messages to send now; the rest waits for `speakingFinished`. */
  offer(messages: ReadonlyArray<unknown>): ReadonlyArray<unknown> {
    if (!this.speaking) return messages;
    this.held.push(...messages);
    return [];
  }

  speakingStarted(): void {
    this.speaking = true;
  }

  speakingFinished(): ReadonlyArray<unknown> {
    this.speaking = false;
    const released = this.held;
    this.held = [];
    return released;
  }
}

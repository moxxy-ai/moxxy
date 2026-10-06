import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypingIndicator } from './typing-indicator.js';

/** Shaped like discord.js's DMChannel: `sendTyping` is a PROTOTYPE method that
 *  reaches the REST client through `this`. */
class DmChannel {
  readonly typingPings: number[] = [];
  private readonly client = { rest: { post: (at: number) => this.typingPings.push(at) } };

  async send(): Promise<never> {
    throw new Error('not used');
  }

  async sendTyping(): Promise<void> {
    this.client.rest.post(Date.now());
  }
}

afterEach(() => vi.useRealTimers());

describe('TypingIndicator', () => {
  it('shows "typing…" on a real discord.js-shaped channel and keeps it alive', async () => {
    vi.useFakeTimers();
    const channel = new DmChannel();
    const typing = new TypingIndicator();

    typing.start(channel);
    await vi.advanceTimersByTimeAsync(8_000);
    typing.stop();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(channel.typingPings).toHaveLength(2);
  });
});

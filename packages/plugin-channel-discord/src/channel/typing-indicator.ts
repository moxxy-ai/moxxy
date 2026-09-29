import type { SendableChannelLike } from './discord-like.js';

/** Discord's typing indicator expires ~10s after `sendTyping`; refresh under that. */
const REFRESH_MS = 8_000;

/**
 * Keeps the "moxxy is typing…" indicator alive for the duration of a turn.
 * Best-effort: transport errors are swallowed (a failed typing ping must never
 * abort a turn).
 */
export class TypingIndicator {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(channel: SendableChannelLike): void {
    this.stop();
    if (!channel.sendTyping) return;
    // Called ON the channel: discord.js's `sendTyping` is a prototype method
    // that reaches the REST client through `this`; a detached call rejects and
    // the swallowed error hid the indicator entirely.
    const ping = (): void => {
      void channel.sendTyping?.().catch(() => undefined);
    };
    ping();
    this.timer = setInterval(ping, REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

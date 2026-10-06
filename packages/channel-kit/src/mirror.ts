import type { MoxxyEvent } from '@moxxy/sdk';
import type { TurnCoordinator } from './turn.js';

/**
 * Where a bot posts replies to turns it did not start (a message typed in the
 * desktop's chat for this bot): the chat the owner last wrote from, or — right
 * after a restart, before anyone wrote — the paired owner's chat.
 */
export class MirrorTarget<Target> {
  private last: Target | null = null;

  constructor(private readonly openOwnerChat: () => Promise<Target | null>) {}

  remember(target: Target): void {
    this.last = target;
  }

  async resolve(): Promise<Target | null> {
    if (this.last !== null) return this.last;
    const owner = await this.openOwnerChat();
    if (owner !== null) this.last = owner;
    return owner;
  }
}

export interface ForeignTurnMirrorOptions<Target> {
  readonly turns: Pick<TurnCoordinator, 'mirrorPrompt' | 'mirrorText'>;
  readonly target: MirrorTarget<Target>;
  /** Deliver one mirrored message (the channel splits it to its size cap). */
  readonly post: (target: Target, text: string) => Promise<void>;
  /** How the channel labels a prompt written in the app. */
  readonly formatPrompt: (prompt: string) => string;
  /** Each mirrored reply, e.g. for a call to say it aloud. */
  readonly onReply?: (text: string) => void;
  readonly onError?: (err: unknown) => void;
}

/**
 * Shows on a messenger the turns another surface ran on the bot's session —
 * the prompt written in the app, then its reply — in order, one at a time.
 * The coordinator skips the channel's own turns by turnId (invariant #8).
 */
export class ForeignTurnMirror<Target> {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: ForeignTurnMirrorOptions<Target>) {}

  accept(event: MoxxyEvent): void {
    const prompt = this.opts.turns.mirrorPrompt(event);
    const reply = this.opts.turns.mirrorText(event);
    if (reply != null) this.opts.onReply?.(reply);
    const text = prompt != null ? this.opts.formatPrompt(prompt) : reply;
    if (text == null) return;
    this.queue = this.queue
      .then(async () => {
        const target = await this.opts.target.resolve();
        if (target !== null) await this.opts.post(target, text);
      })
      .catch((err) => this.opts.onError?.(err));
  }

  /** Resolves once every accepted message has been posted (or failed). */
  idle(): Promise<void> {
    return this.queue;
  }
}

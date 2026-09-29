import type { SendableChannelLike } from './discord-like.js';

/**
 * Where the bot posts replies to turns it did not start (a message typed in
 * the desktop's chat for this bot): the channel the owner last wrote from, or
 * — right after a restart, before anyone wrote — the paired owner's DM.
 */
export class MirrorTarget {
  private last: SendableChannelLike | null = null;

  constructor(private readonly openOwnerDm: () => Promise<SendableChannelLike | null>) {}

  remember(channel: SendableChannelLike): void {
    this.last = channel;
  }

  async resolve(): Promise<SendableChannelLike | null> {
    if (this.last) return this.last;
    const dm = await this.openOwnerDm();
    if (dm) this.last = dm;
    return dm;
  }
}

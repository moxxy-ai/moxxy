import type { ClientSession } from '@moxxy/sdk';

/**
 * A channel bot's `/auto-approve`. Auto-approve belongs to the conversation: the
 * session records the switch, so the desktop's chat with this bot (and any
 * other client) shows and changes the same state, and the core session allows
 * tool calls before the bot's resolver is ever asked. A runner that predates
 * the shared switch reports none — the bot then keeps a flag of its own.
 */
export class AutoApproveSwitch {
  private local = false;

  constructor(private readonly session: () => ClientSession | null) {}

  get enabled(): boolean {
    return this.shared() ?? this.local;
  }

  async toggle(): Promise<boolean> {
    const next = !this.enabled;
    const session = this.session();
    if (session?.setAutoApprove && this.shared() !== undefined) await session.setAutoApprove(next);
    this.local = next;
    return next;
  }

  /** Drop the bot-local flag (a `/new` conversation starts with it off). */
  forgetLocal(): void {
    this.local = false;
  }

  private shared(): boolean | undefined {
    return this.session()?.getInfo().autoApprove;
  }
}

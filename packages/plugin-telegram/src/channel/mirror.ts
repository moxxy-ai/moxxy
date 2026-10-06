import { ForeignTurnMirror, MirrorTarget, type TurnCoordinator } from '@moxxy/channel-kit';
import { sendMarkdown, type TelegramSender } from './send-rich.js';

export type { TelegramSender } from './send-rich.js';

export interface TelegramMirrorOptions {
  readonly turns: Pick<TurnCoordinator, 'mirrorPrompt' | 'mirrorText'>;
  /** The running bot's API, or null while it is stopped. */
  readonly api: () => TelegramSender | null;
  /** The paired chat, or null while unpaired. */
  readonly pairedChat: () => number | null;
  readonly logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
}

/**
 * Turns another surface ran on the bot's session (the desktop's chat with this
 * bot) shown in Telegram: the prompt written in the app, then its reply — into
 * the chat the owner last wrote from, else the paired chat.
 */
export function createTelegramMirror(opts: TelegramMirrorOptions): {
  readonly mirror: ForeignTurnMirror<number>;
  readonly target: MirrorTarget<number>;
} {
  const target = new MirrorTarget<number>(async () => opts.pairedChat());
  const mirror = new ForeignTurnMirror<number>({
    turns: opts.turns,
    target,
    post: async (chatId, text) => {
      const api = opts.api();
      if (api) await sendMarkdown(api, chatId, text);
    },
    formatPrompt: (prompt) => `_typed in moxxy:_ ${prompt}`,
    onError: (err) => opts.logger?.warn('telegram mirror failed', { err: String(err) }),
  });
  return { mirror, target };
}

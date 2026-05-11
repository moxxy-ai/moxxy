import { defineTool, definePlugin, z, type Plugin } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';

export {
  TelegramChannel,
  type TelegramChannelOptions,
  type TelegramStartOpts,
} from './channel.js';
export { TelegramPermissionResolver, type PendingPermission } from './permission.js';
export {
  createPairingState,
  beginPairing,
  handleStart,
  handleCode,
  isAuthorized,
  clearPairing,
  type PairingPhase,
  type PairingState,
  type PairingDecision,
} from './pairing.js';
export { TurnRenderer, splitForTelegram } from './render.js';

export interface BuildTelegramPluginOptions {
  readonly vault: VaultStore;
}

const TOKEN_KEY = 'telegram_bot_token';
const AUTHORIZED_CHAT_KEY = 'telegram_authorized_chat_id';

export function buildTelegramPlugin(opts: BuildTelegramPluginOptions): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-telegram',
    version: '0.0.0',
    tools: [
      defineTool({
        name: 'telegram_set_token',
        description:
          'Store a Telegram bot token (from @BotFather) in the vault under telegram_bot_token. Validates the token shape but does not test connectivity.',
        inputSchema: z.object({
          token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'token must look like 1234567890:ABC...'),
        }),
        permission: { action: 'prompt' },
        handler: async ({ token }) => {
          await opts.vault.set(TOKEN_KEY, token, ['telegram']);
          return `stored Telegram token (${token.split(':')[0]}:…) in vault`;
        },
      }),
      defineTool({
        name: 'telegram_status',
        description: 'Report whether a Telegram token + an authorized chat are configured.',
        inputSchema: z.object({}),
        handler: async () => {
          const hasToken = await opts.vault.has(TOKEN_KEY);
          const authorized = await opts.vault.get(AUTHORIZED_CHAT_KEY);
          return {
            tokenConfigured: hasToken,
            authorizedChatId: authorized ? Number(authorized) : null,
          };
        },
      }),
      defineTool({
        name: 'telegram_unpair',
        description: 'Forget the currently authorized Telegram chat. The next /start will start a fresh pairing.',
        inputSchema: z.object({}),
        permission: { action: 'prompt' },
        handler: async () => {
          const removed = await opts.vault.delete(AUTHORIZED_CHAT_KEY);
          return removed ? 'unpaired' : 'no pairing was active';
        },
      }),
    ],
  });
}

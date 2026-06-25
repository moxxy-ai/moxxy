import { defineChannel, defineTool, definePlugin, z, type LifecycleHooks, type Plugin } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { Api } from 'grammy';
import { TelegramChannel } from './channel.js';
import { TELEGRAM_AUTHORIZED_CHAT_KEY, TELEGRAM_TOKEN_KEY, parseChatId } from './keys.js';
import { runTelegramWizard } from './setup-wizard.js';
import { runPairFlow } from './pair-flow.js';

export {
  TelegramChannel,
  type TelegramChannelOptions,
  type TelegramStartOpts,
} from './channel.js';
export { TelegramPermissionResolver, type PendingPermission } from './permission.js';
export { TelegramApprovalResolver, type PendingApproval } from './approval.js';
export {
  createPairingState,
  beginPairing,
  handleStart,
  submitTerminalCode,
  isAuthorized,
  clearPairing,
  type PairingPhase,
  type PairingState,
  type PairingDecision,
} from './pairing.js';
export type { PairingIssuedEvent, PairingConfirmResult } from './channel.js';
export { TurnRenderer, splitForTelegram } from './render.js';
export { markdownToTelegramHtml } from './format.js';

export interface BuildTelegramPluginOptions {
  readonly vault: VaultStore;
}

export { TELEGRAM_TOKEN_KEY, TELEGRAM_AUTHORIZED_CHAT_KEY, TELEGRAM_TOKEN_RE } from './keys.js';

// Backwards-compat aliases for the existing call sites in this file.
const TOKEN_KEY = TELEGRAM_TOKEN_KEY;
const AUTHORIZED_CHAT_KEY = TELEGRAM_AUTHORIZED_CHAT_KEY;

export function buildTelegramPlugin(opts: BuildTelegramPluginOptions): Plugin {
  // Host-injected vault (available immediately).
  return makeTelegramPlugin(() => opts.vault);
}

/**
 * Discovery-loadable default export: resolves the vault from the inter-plugin
 * service registry in `onInit` (the vault plugin publishes `'vault'`). Requires
 * `@moxxy/plugin-vault` to load first (declared in `package.json`
 * `moxxy.requirements`). The channel + tools read the vault via `getVault()`,
 * so resolution is deferred to call time — after `onInit` has wired it.
 */
export const telegramPlugin: Plugin = (() => {
  let resolved: VaultStore | null = null;
  const getVault = (): VaultStore => {
    if (!resolved) {
      throw new Error(
        '@moxxy/plugin-telegram: the "vault" service is unavailable — @moxxy/plugin-vault must load first',
      );
    }
    return resolved;
  };
  const hooks: LifecycleHooks = {
    onInit: (ctx) => {
      resolved = ctx.services.require<VaultStore>('vault');
    },
  };
  return makeTelegramPlugin(getVault, hooks);
})();

function makeTelegramPlugin(getVault: () => VaultStore, hooks?: LifecycleHooks): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-telegram',
    version: '0.0.0',
    ...(hooks ? { hooks } : {}),
    channels: [
      defineChannel({
        name: 'telegram',
        description: 'Telegram bot channel via grammy. TOFU + code-pairing authorization.',
        create: (deps) =>
          new TelegramChannel({
            vault: getVault(),
            token: (deps.options?.['token'] as string | undefined) ?? undefined,
            logger: deps.logger as never,
          }),
        isAvailable: async () => {
          const envToken = process.env.MOXXY_TELEGRAM_TOKEN;
          if (envToken) return { ok: true };
          try {
            const stored = await getVault().has(TOKEN_KEY);
            if (stored) return { ok: true };
            return {
              ok: false,
              reason:
                "No bot token. Set MOXXY_TELEGRAM_TOKEN, or store one in the vault as '" +
                TOKEN_KEY +
                "' via the `telegram-setup` skill.",
            };
          } catch {
            return {
              ok: false,
              reason:
                'Set MOXXY_TELEGRAM_TOKEN to skip the vault, or unlock the vault first.',
            };
          }
        },
        interactiveCommand: 'setup',
        subcommands: {
          setup: {
            description:
              'Interactive setup: store a bot token, pair a chat, then start the bot. Shown by default for `moxxy telegram` on a TTY.',
            run: async (ctx) => {
              // The wizard drives token entry + pairing through clack
              // prompts, so it needs an interactive terminal. In a
              // headless invocation we just start the bot directly.
              if (process.stdin.isTTY !== true) {
                return ctx.startChannel();
              }
              return runTelegramWizard(ctx);
            },
          },
          pair: {
            description:
              'Open a pairing window. Send /start to your bot in Telegram; it will DM a 6-digit code to paste back in the terminal.',
            run: async (ctx) => {
              // Pairing requires an interactive terminal - the user
              // must paste the bot-issued code into a prompt. In a
              // headless invocation we bail with a clear message
              // instead of silently starting a bot that nobody can
              // confirm.
              if (process.stdin.isTTY !== true) {
                process.stderr.write(
                  'Pairing needs a TTY. Run `moxxy telegram` (interactively) on a workstation, then copy the resulting vault to this host.\n',
                );
                return 1;
              }
              return runPairFlow(ctx);
            },
          },
          unpair: {
            description: 'Forget the currently authorized Telegram chat.',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const removed = await vault.delete(AUTHORIZED_CHAT_KEY);
              process.stdout.write(removed ? 'unpaired\n' : 'no pairing was active\n');
              return 0;
            },
          },
          status: {
            description: 'Report whether a Telegram token + an authorized chat are configured.',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const hasToken = await vault.has(TOKEN_KEY);
              const authorized = await vault.get(AUTHORIZED_CHAT_KEY);
              process.stdout.write(
                JSON.stringify(
                  {
                    tokenConfigured: hasToken,
                    authorizedChatId: parseChatId(authorized),
                  },
                  null,
                  2,
                ) + '\n',
              );
              return 0;
            },
          },
        },
      }),
    ],
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
          await getVault().set(TOKEN_KEY, token, ['telegram']);
          return `stored Telegram token (${token.split(':')[0]}:…) in vault`;
        },
      }),
      defineTool({
        name: 'telegram_status',
        description: 'Report whether a Telegram token + an authorized chat are configured.',
        inputSchema: z.object({}),
        handler: async () => {
          const hasToken = await getVault().has(TOKEN_KEY);
          const authorized = await getVault().get(AUTHORIZED_CHAT_KEY);
          return {
            tokenConfigured: hasToken,
            authorizedChatId: parseChatId(authorized),
          };
        },
      }),
      defineTool({
        name: 'telegram_send_message',
        description:
          'Push a one-off message to the currently authorized Telegram chat. Use this from a ' +
          "scheduled prompt to deliver results without an interactive channel running. The " +
          'message is sent via the Bot API directly — no streaming, no formatting. Requires ' +
          'a stored bot token + a paired chat (run `moxxy channels telegram pair` once).',
        inputSchema: z.object({
          text: z.string().min(1).max(4096),
          /** Optional override; defaults to the vault-paired chat id. */
          chatId: z.number().int().optional(),
          parseMode: z.enum(['MarkdownV2', 'Markdown', 'HTML']).optional(),
        }),
        permission: { action: 'prompt' },
        handler: async ({ text, chatId, parseMode }) => {
          const token = process.env.MOXXY_TELEGRAM_TOKEN ?? (await getVault().get(TOKEN_KEY));
          if (!token) {
            throw new Error(
              'no Telegram bot token configured (set MOXXY_TELEGRAM_TOKEN or run `moxxy init` to store one)',
            );
          }
          const targetChat =
            chatId ?? parseChatId(await getVault().get(AUTHORIZED_CHAT_KEY));
          if (!targetChat) {
            throw new Error(
              'no authorized chat — run `moxxy channels telegram pair` first or pass `chatId` explicitly',
            );
          }
          // Use grammy's lightweight `Api` client directly rather than a full
          // `Bot` (which builds a polling-capable instance + lazily resolves
          // bot info). This is a one-off send — no long-polling — so the Bot
          // wrapper was pure overhead per invocation.
          const api = new Api(token);
          await api.sendMessage(targetChat, text, parseMode ? { parse_mode: parseMode } : {});
          return { delivered: true, chatId: targetChat, length: text.length };
        },
      }),
      defineTool({
        name: 'telegram_unpair',
        description: 'Forget the currently authorized Telegram chat. The next /start will start a fresh pairing.',
        inputSchema: z.object({}),
        permission: { action: 'prompt' },
        handler: async () => {
          const removed = await getVault().delete(AUTHORIZED_CHAT_KEY);
          return removed ? 'unpaired' : 'no pairing was active';
        },
      }),
    ],
  });
}

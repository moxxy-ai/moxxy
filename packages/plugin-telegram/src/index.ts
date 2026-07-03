import { defineChannel, defineTool, definePlugin, z, type LifecycleHooks, type Plugin } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { Api, GrammyError } from 'grammy';
import { markdownToTelegramHtml } from './format.js';
import { stripHtml } from './channel/html.js';
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
  beginHostIssuedPairing,
  handleStart,
  submitChatCode,
  isAuthorized,
  clearPairing,
  type PairingPhase,
  type PairingState,
  type PairingDecision,
} from './pairing.js';
export type { PairingConfirmResult } from './channel.js';
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
        description: 'Telegram bot channel via grammy. QR deep-link chat pairing.',
        // Like Slack, run on a dedicated, isolated runner (separate socket +
        // sticky session) so the bot keeps its own persistent history apart from
        // the user's desktop/TUI work. Telegram long-polls (no tunnel needed).
        dedicatedRunner: true,
        sessionSource: 'telegram',
        // Self-described config so a control surface (TUI `/channels`, `moxxy
        // channels start`) can configure + run Telegram without a hardcoded table.
        config: {
          fields: [
            {
              name: 'token',
              label: 'Bot token',
              vaultKey: TELEGRAM_TOKEN_KEY,
              required: true,
              secret: true,
              placeholder: '123456:ABC-DEF…',
              help: 'Create a bot with @BotFather and paste its token',
            },
          ],
          hasRequestUrl: false,
          runHint:
            'Scan the QR (or open the link) and tap START in Telegram to pair your chat — no code to type.',
          connect: {
            kind: 'qr',
            title: 'Connect your Telegram',
            hint: 'Scan the QR with your phone (or tap Open in Telegram), then press START — your chat pairs automatically.',
            openable: true,
            openLabel: 'Open in Telegram',
          },
        },
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
              'Open a pairing window and print a QR. Scan it (or open the link) and tap START in Telegram to pair your chat — the same mechanism the desktop uses.',
            run: async (ctx) => {
              // Pairing renders a QR for the user to scan, so it needs an
              // interactive terminal. In a headless invocation we bail with a
              // clear message instead of starting a bot nobody can pair. (The
              // desktop Channels panel pairs the same way without a TTY — it
              // renders the QR in the GUI.)
              if (process.stdin.isTTY !== true) {
                process.stderr.write(
                  'Pairing needs a TTY to show the QR. Run `moxxy channels telegram pair` on a workstation, or pair from the desktop Channels panel.\n',
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
        // Vault writes land in ~/.moxxy/vault.json (key material in
        // ~/.moxxy/vault.key) — hence the vault.* glob.
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/vault.*'], write: ['~/.moxxy/vault.*'] },
            net: { mode: 'none' },
            timeMs: 10_000,
          },
        },
        handler: async ({ token }) => {
          await getVault().set(TOKEN_KEY, token, ['telegram']);
          return `stored Telegram token (${token.split(':')[0]}:…) in vault`;
        },
      }),
      defineTool({
        name: 'telegram_status',
        description: 'Report whether a Telegram token + an authorized chat are configured.',
        inputSchema: z.object({}),
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/vault.*'] },
            net: { mode: 'none' },
            timeMs: 10_000,
          },
        },
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
          'scheduled prompt to deliver results without an interactive channel running. By ' +
          'default the text is rendered with the same rich Markdown→Telegram formatting as ' +
          'interactive replies (bold, code, `> [!type]` callouts, `||spoilers||`, etc.); pass ' +
          'an explicit `parseMode` to send the raw text under that parse mode instead. Requires ' +
          'a stored bot token + a paired chat (run `moxxy channels telegram pair` once).',
        inputSchema: z.object({
          text: z.string().min(1).max(4096),
          /** Optional override; defaults to the vault-paired chat id. */
          chatId: z.number().int().optional(),
          /**
           * Force a specific Telegram parse mode and send `text` verbatim under
           * it. Omit to get the default Markdown→HTML rendering (recommended).
           */
          parseMode: z.enum(['MarkdownV2', 'Markdown', 'HTML']).optional(),
        }),
        permission: { action: 'prompt' },
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/vault.*'] },
            net: { mode: 'allowlist', hosts: ['api.telegram.org'] },
            env: ['MOXXY_TELEGRAM_TOKEN'],
            timeMs: 60_000,
          },
        },
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
          if (parseMode) {
            // Explicit mode → caller owns the markup; send text verbatim.
            await api.sendMessage(targetChat, text, { parse_mode: parseMode });
          } else {
            // Default → render Markdown to Telegram HTML for the same rich look
            // as interactive replies, falling back to plain text if the model's
            // text produced an entity Telegram can't parse (rare).
            const html = markdownToTelegramHtml(text);
            try {
              await api.sendMessage(targetChat, html, {
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
              });
            } catch (err) {
              if (err instanceof GrammyError && /can't parse entities|Bad Request: can't parse/i.test(err.description ?? '')) {
                await api.sendMessage(targetChat, stripHtml(html));
              } else {
                throw err;
              }
            }
          }
          return { delivered: true, chatId: targetChat, length: text.length };
        },
      }),
      defineTool({
        name: 'telegram_unpair',
        description: 'Forget the currently authorized Telegram chat. The next /start will start a fresh pairing.',
        inputSchema: z.object({}),
        permission: { action: 'prompt' },
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/vault.*'], write: ['~/.moxxy/vault.*'] },
            net: { mode: 'none' },
            timeMs: 10_000,
          },
        },
        handler: async () => {
          const removed = await getVault().delete(AUTHORIZED_CHAT_KEY);
          return removed ? 'unpaired' : 'no pairing was active';
        },
      }),
    ],
  });
}

// Discovery entry: `createPluginLoader` requires a default Plugin export.
export default telegramPlugin;

import { defineChannel, definePlugin, type LifecycleHooks, type Plugin } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { DiscordChannel } from './channel.js';
import {
  DISCORD_ALLOWED_CHANNELS_KEY,
  DISCORD_AUTHORIZED_USER_KEY,
  DISCORD_TOKEN_ENV,
  DISCORD_TOKEN_KEY,
  parseAllowedChannels,
  parseAuthorizedUser,
  resolveBotToken,
} from './keys.js';
import { runDiscordWizard } from './setup-wizard.js';
import { runPairFlow } from './pair-flow.js';

export {
  DiscordChannel,
  type DiscordChannelOptions,
  type DiscordStartOpts,
  type PairingConfirmResult,
} from './channel.js';
export { DiscordPermissionResolver, type PendingPermission } from './permission.js';
export { DiscordApprovalResolver, type PendingApproval } from './approval.js';
export {
  armPairing,
  clearDiscordPairing,
  confirmPendingCode,
  createDiscordPairingState,
  isUserAuthorized,
  mintCodeForPeer,
  pairingPhase,
  type DiscordPairingDecision,
  type DiscordPairingPhase,
  type DiscordPairingState,
} from './pairing.js';
export { gateInbound, type GateVerdict } from './allow-list.js';
export { DiscordTurnRenderer, splitForDiscord, DISCORD_MESSAGE_LIMIT } from './render.js';
export {
  extractInboundMessage,
  inboundMessageSchema,
  MAX_AUDIO_BYTES,
  MAX_CONTENT_CHARS,
  type InboundAttachment,
  type InboundMessage,
} from './schema.js';
export {
  DISCORD_TOKEN_KEY,
  DISCORD_AUTHORIZED_USER_KEY,
  DISCORD_ALLOWED_CHANNELS_KEY,
  DISCORD_TOKEN_ENV,
  DISCORD_TOKEN_RE,
  parseAuthorizedUser,
  parseAllowedChannels,
  serializeAllowedChannels,
  resolveBotToken,
} from './keys.js';

export interface BuildDiscordPluginOptions {
  /** Host-injected encrypted secret store (available immediately). */
  readonly vault: VaultStore;
}

/**
 * Build the Discord channel plugin with a host-injected vault (mirroring the
 * Telegram plugin's vault injection).
 */
export function buildDiscordPlugin(opts: BuildDiscordPluginOptions): Plugin {
  return makeDiscordPlugin(() => opts.vault);
}

/**
 * Discovery-loadable default export: resolves the vault from the inter-plugin
 * service registry in `onInit` (the vault plugin publishes `'vault'`). Requires
 * `@moxxy/plugin-vault` to load first (declared in `package.json`
 * `moxxy.requirements`). The channel + subcommands read the vault via
 * `getVault()`, so resolution is deferred to call time — after `onInit` wired it.
 */
export const discordPlugin: Plugin = (() => {
  let resolved: VaultStore | null = null;
  const getVault = (): VaultStore => {
    if (!resolved) {
      throw new Error(
        '@moxxy/plugin-channel-discord: the "vault" service is unavailable — @moxxy/plugin-vault must load first',
      );
    }
    return resolved;
  };
  const hooks: LifecycleHooks = {
    onInit: (ctx) => {
      resolved = ctx.services.require<VaultStore>('vault');
    },
  };
  return makeDiscordPlugin(getVault, hooks);
})();

// Discovery entry: `createPluginLoader` requires a default Plugin export.
export default discordPlugin;

function makeDiscordPlugin(getVault: () => VaultStore, hooks?: LifecycleHooks): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-channel-discord',
    version: '0.0.0',
    ...(hooks ? { hooks } : {}),
    channels: [
      defineChannel({
        name: 'discord',
        description:
          'Discord bot channel via discord.js (gateway). DM code pairing; streamed replies via message edits; button-based permission prompts.',
        // Like Slack/Telegram, run on a dedicated, isolated runner (separate
        // socket + sticky session) so the bot keeps its own persistent history
        // apart from the user's desktop/TUI work. The gateway is an outbound
        // WebSocket — no tunnel needed.
        dedicatedRunner: true,
        sessionSource: 'discord',
        // Self-described config so a control surface (TUI `/channels`, `moxxy
        // channels start`) can configure + run Discord without a hardcoded table.
        config: {
          fields: [
            {
              name: 'botToken',
              label: 'Bot token',
              vaultKey: DISCORD_TOKEN_KEY,
              required: true,
              secret: true,
              placeholder: 'MTIz…abc.def…',
              help: 'discord.com/developers → your app → Bot → Reset Token. Enable the MESSAGE CONTENT privileged intent on the same page.',
            },
          ],
          hasRequestUrl: false,
          runHint:
            'Invite the bot to a server via the link shown, then DM it — it replies with a one-time code; finish with `moxxy discord pair` in a terminal.',
          connect: {
            kind: 'url',
            title: 'Invite the bot',
            hint: 'Open the link to invite the bot to your server, then DM it to receive a pairing code and finish with `moxxy discord pair`.',
            openable: true,
            openLabel: 'Open Discord authorization',
          },
        },
        create: (deps) =>
          new DiscordChannel({
            vault: getVault(),
            token: (deps.options?.['token'] as string | undefined) ?? undefined,
            logger: deps.logger as never,
            ...(typeof deps.options?.['editFrameMs'] === 'number'
              ? { editFrameMs: deps.options['editFrameMs'] as number }
              : {}),
          }),
        isAvailable: async () => {
          // Env-first: a fully env-configured bot is available even in a probe
          // context (e.g. the `moxxy channels` listing) where onInit has not
          // yet wired the vault service, so `getVault()` would throw.
          if (process.env[DISCORD_TOKEN_ENV]?.trim()) return { ok: true };
          try {
            if ((await resolveBotToken(getVault())) != null) return { ok: true };
            return {
              ok: false,
              reason:
                "No bot token. Set MOXXY_DISCORD_TOKEN, or store one in the vault as '" +
                DISCORD_TOKEN_KEY +
                "' via `moxxy discord setup`.",
            };
          } catch {
            return {
              ok: false,
              reason: 'Set MOXXY_DISCORD_TOKEN to skip the vault, or unlock the vault first.',
            };
          }
        },
        interactiveCommand: 'setup',
        subcommands: {
          setup: {
            description:
              'Interactive setup: store a bot token (with privileged-intent guidance), pair an account, then start the bot. Shown by default for `moxxy discord` on a TTY.',
            run: async (ctx) => {
              // The wizard drives token entry + pairing through clack prompts,
              // so it needs an interactive terminal. In a headless invocation
              // we just start the bot directly.
              if (process.stdin.isTTY !== true) {
                return ctx.startChannel();
              }
              return runDiscordWizard(ctx);
            },
          },
          pair: {
            description:
              'DM code pairing: start the bot with a pairing window armed, DM it from your account, then paste the code it replies with.',
            run: async (ctx) => {
              // Pairing needs the operator to paste a code, so it needs an
              // interactive terminal. In a headless invocation we bail with a
              // clear message instead of starting a bot nobody can pair.
              if (process.stdin.isTTY !== true) {
                process.stderr.write(
                  'Pairing needs a TTY (you paste the code the bot DMs back). Run `moxxy channels discord pair` on a workstation.\n',
                );
                return 1;
              }
              return runPairFlow(ctx);
            },
          },
          unpair: {
            description: 'Forget the currently authorized Discord account.',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const removed = await vault.delete(DISCORD_AUTHORIZED_USER_KEY);
              process.stdout.write(removed ? 'unpaired\n' : 'no pairing was active\n');
              return 0;
            },
          },
          status: {
            description:
              'Report whether a Discord token + an authorized account + allow-listed channels are configured.',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const hasToken =
                !!process.env[DISCORD_TOKEN_ENV]?.trim() || (await vault.has(DISCORD_TOKEN_KEY));
              const authorized = await vault.get(DISCORD_AUTHORIZED_USER_KEY);
              const allowed = parseAllowedChannels(
                await vault.get(DISCORD_ALLOWED_CHANNELS_KEY),
              );
              process.stdout.write(
                JSON.stringify(
                  {
                    tokenConfigured: hasToken,
                    authorizedUserId: parseAuthorizedUser(authorized),
                    allowedChannelIds: allowed,
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
  });
}

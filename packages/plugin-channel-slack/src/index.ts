import {
  defineChannel,
  definePlugin,
  type LifecycleHooks,
  type Plugin,
} from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { SlackChannel, type SlackChannelOptions } from './channel.js';
import {
  SLACK_AUTHORIZED_KEY,
  SLACK_BOT_TOKEN_ENV,
  SLACK_BOT_TOKEN_KEY,
  SLACK_SIGNING_SECRET_ENV,
  SLACK_SIGNING_SECRET_KEY,
  parseAuthorization,
  resolveBotToken,
  resolveSigningSecret,
} from './keys.js';
import { runSlackWizard } from './setup-wizard.js';
import { runSlackPairFlow } from './pair-flow.js';

export {
  SlackChannel,
  type SlackChannelOptions,
  type SlackStartOpts,
  type PairCandidate,
} from './channel.js';
export { buildSlackPermissionResolver } from './permission.js';
export { SlackClient } from './channel/slack-client.js';
export { verifySlackSignature, SLACK_REPLAY_WINDOW_SEC } from './server/verify.js';
export { slackEnvelopeSchema, eventCallbackSchema, urlVerificationSchema } from './server/schema.js';
export { DeliveryDedupeCache } from './server/dedupe.js';
export { IngestServer, SLACK_EVENTS_PATH } from './server/ingest-server.js';
export {
  SLACK_BOT_TOKEN_KEY,
  SLACK_SIGNING_SECRET_KEY,
  SLACK_AUTHORIZED_KEY,
  SLACK_BOT_TOKEN_ENV,
  SLACK_SIGNING_SECRET_ENV,
  resolveBotToken,
  resolveSigningSecret,
  parseAuthorization,
  authorizationMatches,
  type SlackAuthorization,
} from './keys.js';

export interface BuildSlackPluginOptions {
  /** Host-injected encrypted secret store (available immediately). */
  readonly vault: VaultStore;
}

/**
 * Build the Slack channel plugin. The CLI passes the concrete vault (mirroring
 * the Telegram plugin's vault injection). The channel exposes its own ingest
 * server publicly via the self-hosted `proxyTunnel` (imported directly, like
 * the webhooks tunnel).
 */
export function buildSlackPlugin(opts: BuildSlackPluginOptions): Plugin {
  return makeSlackPlugin(() => opts.vault);
}

/**
 * Discovery-loadable default export: resolves the vault from the inter-plugin
 * service registry in `onInit` (the vault plugin publishes `'vault'`). Requires
 * `@moxxy/plugin-vault` to load first (declared in `package.json`
 * `moxxy.requirements`). The channel + subcommands read the vault via
 * `getVault()`, so resolution is deferred to call time — after `onInit` wired it.
 */
export const slackPlugin: Plugin = (() => {
  let resolved: VaultStore | null = null;
  const getVault = (): VaultStore => {
    if (!resolved) {
      throw new Error(
        '@moxxy/plugin-channel-slack: the "vault" service is unavailable — @moxxy/plugin-vault must load first',
      );
    }
    return resolved;
  };
  const hooks: LifecycleHooks = {
    onInit: (ctx) => {
      resolved = ctx.services.require<VaultStore>('vault');
    },
  };
  return makeSlackPlugin(getVault, hooks);
})();

export default slackPlugin;

function readAllowedTools(options: Record<string, unknown> | undefined): string[] | undefined {
  const raw = options?.['allowedTools'];
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  return undefined;
}

function makeSlackPlugin(getVault: () => VaultStore, hooks?: LifecycleHooks): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-channel-slack',
    version: '0.0.0',
    ...(hooks ? { hooks } : {}),
    // NB: we do NOT register a tunnelProvider here. The channel opens its ingest
    // tunnel by importing `proxyTunnel` directly (see ingest-server), exactly like
    // the webhooks plugin. Registering it would throw "already registered" when the
    // web channel (which does register `proxyTunnel`) is also loaded, silently
    // dropping this whole plugin — the tunnel-providers registry rejects duplicates.
    channels: [
      defineChannel({
        name: 'slack',
        description:
          'Slack bot channel: ingests the Events API over the proxy relay and streams threaded replies. Autonomous allow-list permissions (no human in the loop).',
        // Runs on its own dedicated, isolated runner (separate socket + sticky
        // session) so the bot operates independently of the user's desktop/TUI.
        // The CLI reads these generically — no per-channel name list.
        dedicatedRunner: true,
        sessionSource: 'slack',
        // Self-described config so a control surface (TUI `/channels`, `moxxy
        // channels start`) can configure + run Slack without a hardcoded table.
        // The vault keys named here are the ones the channel reads at boot.
        config: {
          fields: [
            {
              name: 'botToken',
              label: 'Bot token',
              vaultKey: SLACK_BOT_TOKEN_KEY,
              required: true,
              secret: true,
              placeholder: 'xoxb-…',
              help: 'Slack app → OAuth & Permissions → Bot User OAuth Token',
            },
            {
              name: 'signingSecret',
              label: 'Signing secret',
              vaultKey: SLACK_SIGNING_SECRET_KEY,
              required: true,
              secret: true,
              help: 'Slack app → Basic Information → App Credentials → Signing Secret',
            },
          ],
          hasRequestUrl: true,
          runHint:
            'Paste the Request URL into your Slack app → Event Subscriptions, subscribe to the app_mention bot event, then mention the bot in a channel to pair.',
          connect: {
            kind: 'url',
            title: 'Request URL',
            hint: 'Paste this into your Slack app → Event Subscriptions, subscribe to the app_mention bot event, then mention the bot in a channel to pair.',
          },
        },
        create: (deps) => {
          const options = deps.options;
          const allowedTools = readAllowedTools(options);
          const editFrameMs = options?.['editFrameMs'];
          const host = options?.['host'];
          const channelOpts: SlackChannelOptions = {
            vault: getVault(),
            ...(allowedTools ? { allowedTools } : {}),
            ...(typeof editFrameMs === 'number' ? { editFrameMs } : {}),
            ...(typeof host === 'string' ? { host } : {}),
            logger: deps.logger as never,
          };
          return new SlackChannel(channelOpts);
        },
        isAvailable: async () => {
          // Env-first: a fully env-configured bot is available even in a probe
          // context (e.g. the `moxxy channels` listing) where onInit has not yet
          // wired the vault service, so `getVault()` would throw.
          let hasToken = (process.env[SLACK_BOT_TOKEN_ENV]?.trim() ?? '') !== '';
          let hasSecret = (process.env[SLACK_SIGNING_SECRET_ENV]?.trim() ?? '') !== '';
          if (hasToken && hasSecret) return { ok: true };
          try {
            const vault = getVault();
            if (!hasToken) hasToken = (await resolveBotToken(vault)) != null;
            if (!hasSecret) hasSecret = (await resolveSigningSecret(vault)) != null;
          } catch {
            // Vault unavailable in a probe/listing context — fall through to the
            // "missing secrets" message below (env was already checked above).
          }
          if (hasToken && hasSecret) return { ok: true };
          const missing: string[] = [];
          if (!hasToken) missing.push('bot token (slack_bot_token / MOXXY_SLACK_BOT_TOKEN)');
          if (!hasSecret) missing.push('signing secret (slack_signing_secret / MOXXY_SLACK_SIGNING_SECRET)');
          return {
            ok: false,
            reason: `Missing ${missing.join(' and ')}. Run \`moxxy channels slack setup\`.`,
          };
        },
        interactiveCommand: 'setup',
        subcommands: {
          setup: {
            description:
              'Interactive setup: store the bot token + signing secret, validate via auth.test, pick the allow-list, open the tunnel, and print the Slack Request URL. Shown by default for `moxxy slack` on a TTY.',
            run: async (ctx) => {
              if (process.stdin.isTTY !== true) {
                // Headless: just start the channel (secrets must already be set).
                return ctx.startChannel();
              }
              return runSlackWizard(ctx);
            },
          },
          pair: {
            description:
              'TOFU pairing: arm a window, then authorize the first team/channel that @mentions the bot.',
            run: async (ctx) => {
              if (process.stdin.isTTY !== true) {
                process.stderr.write(
                  'Pairing needs a TTY (you confirm the team/channel). Run `moxxy slack pair` interactively.\n',
                );
                return 1;
              }
              return runSlackPairFlow(ctx);
            },
          },
          status: {
            description: 'Report token/secret/authorization state as JSON.',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const botTokenConfigured = (await resolveBotToken(vault)) != null;
              const signingSecretConfigured = (await resolveSigningSecret(vault)) != null;
              const authorized = parseAuthorization(await vault.get(SLACK_AUTHORIZED_KEY));
              process.stdout.write(
                JSON.stringify(
                  {
                    botTokenConfigured,
                    signingSecretConfigured,
                    authorized,
                    tunnelUrl: null,
                  },
                  null,
                  2,
                ) + '\n',
              );
              return 0;
            },
          },
          unpair: {
            description: 'Forget the authorized Slack team/channel.',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const removed = await vault.delete(SLACK_AUTHORIZED_KEY);
              process.stdout.write(removed ? 'unpaired\n' : 'no pairing was active\n');
              return 0;
            },
          },
        },
      }),
    ],
  });
}

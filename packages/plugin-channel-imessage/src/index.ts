import { defineChannel, definePlugin, type LifecycleHooks, type Plugin } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { ImessageChannel, type ImessageChannelOptions } from './channel.js';
import {
  IMESSAGE_ALLOWED_HANDLES_KEY,
  IMESSAGE_OWNER_HANDLES_KEY,
  IMESSAGE_SERVER_PASSWORD_ENV,
  IMESSAGE_SERVER_PASSWORD_KEY,
  IMESSAGE_SERVER_URL_ENV,
  IMESSAGE_SERVER_URL_KEY,
  parseHandleList,
} from './keys.js';
import { runImessageWizard } from './setup-wizard.js';

export {
  ImessageChannel,
  type ImessageChannelOptions,
  type ImessageStartOpts,
} from './channel.js';
export { buildImessagePermissionResolver } from './permission.js';
export {
  BlueBubblesClient,
  makeTempGuid,
  type BlueBubblesClientLike,
  type BlueBubblesClientOptions,
  type SocketLike,
} from './bluebubbles-client.js';
export { gateInboundMessage, type GateState, type GateVerdict } from './message-gate.js';
export { messageSchema, MAX_INBOUND_TEXT_CHARS, type ImessageMessage } from './schema.js';
export {
  ChunkedSender,
  takeChunk,
  splitForImessage,
  IMESSAGE_CHUNK_SOFT_LIMIT,
  IMESSAGE_CHUNK_HARD_LIMIT,
} from './channel/chunker.js';
export {
  IMESSAGE_SERVER_URL_KEY,
  IMESSAGE_SERVER_URL_ENV,
  IMESSAGE_SERVER_PASSWORD_KEY,
  IMESSAGE_SERVER_PASSWORD_ENV,
  IMESSAGE_ALLOWED_HANDLES_KEY,
  IMESSAGE_OWNER_HANDLES_KEY,
  parseHandleList,
  parseDmChatGuid,
  normalizeHandle,
  isHandle,
  E164_RE,
  EMAIL_RE,
} from './keys.js';

export interface BuildImessagePluginOptions {
  /** Host-injected encrypted secret store (available immediately). */
  readonly vault: VaultStore;
}

/**
 * Build the iMessage channel plugin with a host-injected vault (mirrors the
 * Signal/WhatsApp plugins' vault injection).
 */
export function buildImessagePlugin(opts: BuildImessagePluginOptions): Plugin {
  return makeImessagePlugin(() => opts.vault);
}

/**
 * Discovery-loadable default export: resolves the vault from the inter-plugin
 * service registry in `onInit` (the vault plugin publishes `'vault'`). Requires
 * `@moxxy/plugin-vault` to load first (declared in `package.json`
 * `moxxy.requirements`).
 */
export const imessagePlugin: Plugin = (() => {
  let resolved: VaultStore | null = null;
  const getVault = (): VaultStore => {
    if (!resolved) {
      throw new Error(
        '@moxxy/plugin-channel-imessage: the "vault" service is unavailable — @moxxy/plugin-vault must load first',
      );
    }
    return resolved;
  };
  const hooks: LifecycleHooks = {
    onInit: (ctx) => {
      resolved = ctx.services.require<VaultStore>('vault');
    },
  };
  return makeImessagePlugin(getVault, hooks);
})();

export default imessagePlugin;

function readStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((x) => String(x));
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

function envConfigured(): boolean {
  const url = process.env[IMESSAGE_SERVER_URL_ENV];
  const pass = process.env[IMESSAGE_SERVER_PASSWORD_ENV];
  return typeof url === 'string' && url.trim().length > 0 && typeof pass === 'string' && pass.trim().length > 0;
}

function makeImessagePlugin(getVault: () => VaultStore, hooks?: LifecycleHooks): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-channel-imessage',
    version: '0.0.0',
    ...(hooks ? { hooks } : {}),
    channels: [
      defineChannel({
        name: 'imessage',
        description:
          'iMessage channel via a localhost BlueBubbles server (macOS only). Allow-listed handles (and your own self-chat) drive the agent; replies go out as buffered chunked sends.',
        // A BlueBubbles server sees ALL the account owner's messages, so this
        // channel runs on its own dedicated, isolated runner (separate socket +
        // sticky session), like Signal — it keeps its own persistent history
        // apart from the user's desktop/TUI work.
        dedicatedRunner: true,
        sessionSource: 'imessage',
        config: {
          fields: [
            {
              name: 'serverUrl',
              label: 'BlueBubbles server URL',
              vaultKey: IMESSAGE_SERVER_URL_KEY,
              required: true,
              secret: false,
              placeholder: 'http://localhost:1234',
              help: 'The BlueBubbles server running on this Mac (default port 1234)',
            },
            {
              name: 'password',
              label: 'BlueBubbles server password',
              vaultKey: IMESSAGE_SERVER_PASSWORD_KEY,
              required: true,
              secret: true,
              help: 'The password set in the BlueBubbles app (sent as a query param on every request)',
            },
          ],
          hasRequestUrl: false,
          runHint:
            'Install the BlueBubbles server on this Mac, sign in to Messages, set a password, then run `moxxy channels imessage setup` to add allowed handles.',
          connect: {
            kind: 'instructions',
            title: 'Connect BlueBubbles',
            steps: [
              'Install the BlueBubbles server on this Mac from https://bluebubbles.app and sign in to Messages.',
              'In the BlueBubbles app, set a server password and note the port (default 1234).',
              'Run `moxxy channels imessage setup` and paste the URL + password, then add the handles allowed to talk to moxxy.',
            ],
          },
        },
        create: (deps) => {
          const options = deps.options;
          const channelOpts: ImessageChannelOptions = {
            vault: getVault(),
            ...(typeof options?.['serverUrl'] === 'string' ? { serverUrl: options['serverUrl'] } : {}),
            ...(typeof options?.['password'] === 'string' ? { password: options['password'] } : {}),
            ...(() => {
              const tools = readStringArray(options?.['allowedTools']);
              return tools ? { allowedTools: tools } : {};
            })(),
            ...(() => {
              const handles = readStringArray(options?.['allowedHandles']);
              return handles ? { allowedHandles: handles } : {};
            })(),
            ...(() => {
              const handles = readStringArray(options?.['ownerHandles']);
              return handles ? { ownerHandles: handles } : {};
            })(),
            logger: deps.logger as never,
          };
          return new ImessageChannel(channelOpts);
        },
        isAvailable: async () => {
          // Pure check — NO network probe (this runs on every `moxxy channels
          // list` / `moxxy doctor`). The reachability ping is deferred to start().
          if (process.platform !== 'darwin') {
            return {
              ok: false,
              reason: 'iMessage requires macOS (a BlueBubbles server running on this Mac).',
            };
          }
          // Env pair short-circuit (the vault may not be wired in a probe context).
          if (envConfigured()) return { ok: true };
          try {
            const vault = getVault();
            if ((await vault.has(IMESSAGE_SERVER_URL_KEY)) && (await vault.has(IMESSAGE_SERVER_PASSWORD_KEY))) {
              return { ok: true };
            }
          } catch {
            /* vault unavailable in a probe context — fall through */
          }
          return {
            ok: false,
            reason: 'No BlueBubbles server configured. Run `moxxy channels imessage setup`.',
          };
        },
        interactiveCommand: 'setup',
        subcommands: {
          setup: {
            description:
              'Interactive setup: store the BlueBubbles server URL + password, the handle allow-list and your own self-chat handles, pick the tool allow-list, then start. Shown by default for `moxxy imessage` on a TTY.',
            run: async (ctx) => {
              if (process.stdin.isTTY !== true) {
                // Headless: just start the channel (server must already be configured).
                return ctx.startChannel();
              }
              return runImessageWizard(ctx);
            },
          },
          status: {
            description: 'Report platform / server-config / allow-list state as JSON.',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const serverUrl =
                process.env[IMESSAGE_SERVER_URL_ENV]?.trim() || (await vault.get(IMESSAGE_SERVER_URL_KEY));
              const passwordSet =
                (process.env[IMESSAGE_SERVER_PASSWORD_ENV]?.trim() ?? '').length > 0 ||
                (await vault.has(IMESSAGE_SERVER_PASSWORD_KEY));
              const allowedHandles = parseHandleList(await vault.get(IMESSAGE_ALLOWED_HANDLES_KEY));
              const ownerHandles = parseHandleList(await vault.get(IMESSAGE_OWNER_HANDLES_KEY));
              process.stdout.write(
                JSON.stringify(
                  {
                    platform: process.platform,
                    supported: process.platform === 'darwin',
                    serverUrl: serverUrl || null,
                    passwordSet,
                    allowedHandles,
                    ownerHandles,
                  },
                  null,
                  2,
                ) + '\n',
              );
              return 0;
            },
          },
          unpair: {
            description:
              'Forget the stored BlueBubbles server URL + password and the handle allow-list. (The BlueBubbles app itself is untouched — uninstall or reset it there to fully disconnect.)',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const removedUrl = await vault.delete(IMESSAGE_SERVER_URL_KEY);
              await vault.delete(IMESSAGE_SERVER_PASSWORD_KEY);
              await vault.delete(IMESSAGE_ALLOWED_HANDLES_KEY);
              await vault.delete(IMESSAGE_OWNER_HANDLES_KEY);
              process.stdout.write(
                removedUrl
                  ? 'unpaired (vault cleared). The BlueBubbles server app is untouched — reset it there to fully disconnect.\n'
                  : 'no BlueBubbles server was configured\n',
              );
              return 0;
            },
          },
        },
      }),
    ],
  });
}

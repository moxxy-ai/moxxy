import { defineChannel, definePlugin, type LifecycleHooks, type Plugin } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { SignalChannel, type SignalChannelOptions } from './channel.js';
import {
  SIGNAL_ACCOUNT_ENV,
  SIGNAL_ACCOUNT_KEY,
  SIGNAL_ALLOWED_SENDERS_KEY,
  parseAllowedSenders,
} from './keys.js';
import {
  SIGNAL_CLI_INSTALL_HINT,
  findSignalCliOnPath,
  listSignalAccounts,
  signalCliDataDir,
} from './sidecar.js';
import { runSignalWizard } from './setup-wizard.js';
import { runSignalPairFlow } from './pair-flow.js';

export {
  SignalChannel,
  type SignalChannelOptions,
  type SignalStartOpts,
  type SendTarget,
  type SignalRpcLike,
  type SignalSidecarLike,
} from './channel.js';
export { buildSignalPermissionResolver } from './permission.js';
export { SignalRpcClient, type RpcStream } from './jsonrpc.js';
export {
  SignalSidecar,
  startLinkProcess,
  listSignalAccounts,
  findSignalCliOnPath,
  signalCliDataDir,
  signalCliAttachmentsDir,
  SIGNAL_CLI_INSTALL_HINT,
  type LinkProcessHandle,
  type SpawnFn,
  type SpawnedProcess,
} from './sidecar.js';
export {
  receiveParamsSchema,
  envelopeSchema,
  attachmentSchema,
  MAX_INBOUND_TEXT_CHARS,
  type SignalEnvelope,
  type SignalAttachment,
} from './schema.js';
export {
  ChunkedSender,
  takeChunk,
  splitForSignal,
  SIGNAL_CHUNK_SOFT_LIMIT,
  SIGNAL_CHUNK_HARD_LIMIT,
} from './channel/chunker.js';
export {
  SIGNAL_ACCOUNT_KEY,
  SIGNAL_ACCOUNT_ENV,
  SIGNAL_ALLOWED_SENDERS_KEY,
  parseAllowedSenders,
  normalizeSender,
  E164_RE,
} from './keys.js';

export interface BuildSignalPluginOptions {
  /** Host-injected encrypted secret store (available immediately). */
  readonly vault: VaultStore;
}

/**
 * Build the Signal channel plugin with a host-injected vault (mirrors the
 * Telegram/Slack plugins' vault injection).
 */
export function buildSignalPlugin(opts: BuildSignalPluginOptions): Plugin {
  return makeSignalPlugin(() => opts.vault);
}

/**
 * Discovery-loadable default export: resolves the vault from the inter-plugin
 * service registry in `onInit` (the vault plugin publishes `'vault'`). Requires
 * `@moxxy/plugin-vault` to load first (declared in `package.json`
 * `moxxy.requirements`). The channel + subcommands read the vault via
 * `getVault()`, so resolution is deferred to call time — after `onInit` wired it.
 */
export const signalPlugin: Plugin = (() => {
  let resolved: VaultStore | null = null;
  const getVault = (): VaultStore => {
    if (!resolved) {
      throw new Error(
        '@moxxy/plugin-channel-signal: the "vault" service is unavailable — @moxxy/plugin-vault must load first',
      );
    }
    return resolved;
  };
  const hooks: LifecycleHooks = {
    onInit: (ctx) => {
      resolved = ctx.services.require<VaultStore>('vault');
    },
  };
  return makeSignalPlugin(getVault, hooks);
})();

export default signalPlugin;

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

function makeSignalPlugin(getVault: () => VaultStore, hooks?: LifecycleHooks): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-channel-signal',
    version: '0.0.0',
    ...(hooks ? { hooks } : {}),
    channels: [
      defineChannel({
        name: 'signal',
        description:
          'Signal messenger channel via a signal-cli JSON-RPC sidecar. Links as a secondary device (QR); Note-to-Self + allow-listed senders drive the agent.',
        // A linked device sees ALL the account owner's messages, so this
        // channel runs on its own dedicated, isolated runner (separate socket +
        // sticky session), like Slack — the bot keeps its own persistent
        // history apart from the user's desktop/TUI work.
        dedicatedRunner: true,
        sessionSource: 'signal',
        // Self-described config so a control surface (TUI `/channels`, `moxxy
        // channels start`, the desktop panel) can configure + run Signal
        // without a hardcoded table.
        config: {
          fields: [
            {
              name: 'account',
              label: 'Account number (E.164)',
              vaultKey: SIGNAL_ACCOUNT_KEY,
              required: true,
              secret: false,
              placeholder: '+15551234567',
              help: 'The Signal account moxxy links to as a secondary device (needs signal-cli on PATH)',
            },
          ],
          hasRequestUrl: false,
          runHint:
            'Scan the QR with your phone (Signal → Settings → Linked Devices → Link New Device); then message your own "Note to Self" to talk to moxxy.',
          connect: {
            kind: 'qr',
            title: 'Link your Signal',
            hint: 'On your phone: Signal → Settings → Linked Devices → Link New Device, then scan the QR.',
          },
        },
        create: (deps) => {
          const options = deps.options;
          const channelOpts: SignalChannelOptions = {
            vault: getVault(),
            ...(typeof options?.['account'] === 'string' ? { account: options['account'] } : {}),
            ...(typeof options?.['binary'] === 'string' ? { binary: options['binary'] } : {}),
            ...(() => {
              const tools = readStringArray(options?.['allowedTools']);
              return tools ? { allowedTools: tools } : {};
            })(),
            ...(() => {
              const senders = readStringArray(options?.['allowedSenders']);
              return senders ? { allowedSenders: senders } : {};
            })(),
            logger: deps.logger as never,
          };
          return new SignalChannel(channelOpts);
        },
        isAvailable: async () => {
          // Gate 1: the signal-cli binary. A pure PATH scan (no spawn — this
          // runs on every `moxxy channels list` / `moxxy doctor`), and a miss
          // must NEVER crash discovery: return a friendly install hint.
          try {
            if (!findSignalCliOnPath()) {
              return { ok: false, reason: SIGNAL_CLI_INSTALL_HINT };
            }
          } catch {
            return { ok: false, reason: SIGNAL_CLI_INSTALL_HINT };
          }
          // Gate 2: an account number (env first — the vault may not be wired
          // in a probe/listing context).
          if (process.env[SIGNAL_ACCOUNT_ENV]?.trim()) return { ok: true };
          try {
            if (await getVault().has(SIGNAL_ACCOUNT_KEY)) return { ok: true };
          } catch {
            /* vault unavailable in a probe context — fall through */
          }
          return {
            ok: false,
            reason: `No Signal account configured. Run \`moxxy channels signal setup\`, set ${SIGNAL_ACCOUNT_ENV}, or store one in the vault as '${SIGNAL_ACCOUNT_KEY}'.`,
          };
        },
        interactiveCommand: 'setup',
        subcommands: {
          setup: {
            description:
              'Interactive setup: check signal-cli, store the account number, pick the tool allow-list, then link + start. Shown by default for `moxxy signal` on a TTY.',
            run: async (ctx) => {
              if (process.stdin.isTTY !== true) {
                // Headless: just start the channel (account must already be
                // configured + linked).
                return ctx.startChannel();
              }
              return runSignalWizard(ctx);
            },
          },
          pair: {
            description:
              'Link this machine to your Signal account: prints a QR to scan from Signal → Settings → Linked Devices — the same mechanism the desktop uses.',
            run: async (ctx) => {
              if (process.stdin.isTTY !== true) {
                process.stderr.write(
                  'Pairing needs a TTY to show the QR. Run `moxxy channels signal pair` on a workstation, or pair from the desktop Channels panel.\n',
                );
                return 1;
              }
              return runSignalPairFlow(ctx);
            },
          },
          status: {
            description:
              'Report signal-cli / account / linking / allow-list state as JSON.',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const binary = findSignalCliOnPath();
              const account =
                process.env[SIGNAL_ACCOUNT_ENV]?.trim() || (await vault.get(SIGNAL_ACCOUNT_KEY));
              const allowedSenders = parseAllowedSenders(
                await vault.get(SIGNAL_ALLOWED_SENDERS_KEY),
              );
              // Linked state needs a one-shot signal-cli spawn (slow JVM);
              // report null when the probe isn't possible/fails.
              let linked: boolean | null = null;
              if (binary && account) {
                try {
                  linked = (await listSignalAccounts({ binary })).includes(account);
                } catch {
                  linked = null;
                }
              }
              process.stdout.write(
                JSON.stringify(
                  {
                    binaryFound: binary != null,
                    account: account || null,
                    linked,
                    allowedSenders,
                    dataDir: signalCliDataDir(),
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
              "Forget the stored account + sender allow-list. (signal-cli's own linked-device store is untouched; remove the device from Signal → Linked Devices on your phone to fully unlink.)",
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const removedAccount = await vault.delete(SIGNAL_ACCOUNT_KEY);
              await vault.delete(SIGNAL_ALLOWED_SENDERS_KEY);
              process.stdout.write(
                removedAccount
                  ? 'unpaired (vault cleared). To fully unlink, remove the "moxxy" device in Signal → Settings → Linked Devices on your phone.\n'
                  : 'no account was configured\n',
              );
              return 0;
            },
          },
        },
      }),
    ],
  });
}

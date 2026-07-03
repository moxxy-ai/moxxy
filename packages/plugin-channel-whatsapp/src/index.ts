import { defineChannel, definePlugin, type LifecycleHooks, type Plugin } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import type { VaultStore } from '@moxxy/plugin-vault';
import { createFileAuthStorage, hasStoredCreds } from './auth-state.js';
import { WhatsAppChannel, type WhatsAppChannelOptions } from './channel.js';
import { CONSENT_REQUIRED_MESSAGE, hasConsent } from './consent.js';
import {
  WHATSAPP_ALLOWED_JIDS_KEY,
  WHATSAPP_AUTH_DIR,
  WHATSAPP_CONSENT_KEY,
  WHATSAPP_OWNER_JID_KEY,
  parseAllowedJids,
} from './keys.js';
import { runWhatsAppWizard, unpairLocal } from './setup-wizard.js';
import { runWhatsAppPairFlow } from './pair-flow.js';

export { WhatsAppChannel, type WhatsAppChannelOptions, type WhatsAppStartOpts } from './channel.js';
export {
  createWhatsAppPermissionController,
  parsePermissionReply,
  formatPermissionPrompt,
  type WhatsAppPermissionController,
} from './permission.js';
export {
  createFileAuthStorage,
  createWhatsAppAuthState,
  hasStoredCreds,
  sanitizeAuthKey,
  type WhatsAppAuthStorage,
  type BaileysAuthBridge,
} from './auth-state.js';
export {
  gateInboundMessage,
  MAX_AUDIO_BYTES,
  MAX_TEXT_CHARS,
  type GateVerdict,
} from './message-gate.js';
export {
  runWhatsAppTurn,
  splitWhatsAppText,
  WHATSAPP_MAX_MESSAGE_CHARS,
} from './channel/turn-runner.js';
export { CONSENT_WARNING, CONSENT_REQUIRED_MESSAGE, hasConsent, recordConsent } from './consent.js';
export {
  WHATSAPP_CONSENT_KEY,
  WHATSAPP_OWNER_JID_KEY,
  WHATSAPP_ALLOWED_JIDS_KEY,
  WHATSAPP_CONSENT_ENV,
  WHATSAPP_AUTH_DIR,
  normalizeJid,
  parseAllowedJids,
  isConsentValue,
} from './keys.js';
export {
  disconnectStatusCode,
  WA_DISCONNECT,
  type WhatsAppSocket,
  type WhatsAppSocketFactory,
} from './socket.js';

export interface BuildWhatsAppPluginOptions {
  /** Host-injected encrypted secret store (available immediately). */
  readonly vault: VaultStore;
}

/** Build the WhatsApp channel plugin with a host-injected vault (mirrors the
 *  Telegram/Slack plugins' dual-export pattern). */
export function buildWhatsAppPlugin(opts: BuildWhatsAppPluginOptions): Plugin {
  return makeWhatsAppPlugin(() => opts.vault);
}

/**
 * Discovery-loadable default export: resolves the vault from the inter-plugin
 * service registry in `onInit` (the vault plugin publishes `'vault'`). Requires
 * `@moxxy/plugin-vault` to load first (declared in `package.json`
 * `moxxy.requirements`).
 */
export const whatsappPlugin: Plugin = (() => {
  let resolved: VaultStore | null = null;
  const getVault = (): VaultStore => {
    if (!resolved) {
      throw new Error(
        '@moxxy/plugin-channel-whatsapp: the "vault" service is unavailable — @moxxy/plugin-vault must load first',
      );
    }
    return resolved;
  };
  const hooks: LifecycleHooks = {
    onInit: (ctx) => {
      resolved = ctx.services.require<VaultStore>('vault');
    },
  };
  return makeWhatsAppPlugin(getVault, hooks);
})();

export default whatsappPlugin;

function readAllowedJids(options: Record<string, unknown> | undefined): string[] | undefined {
  const raw = options?.['allowedJids'];
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (typeof raw === 'string' && raw.trim().length > 0) return parseAllowedJids(raw);
  return undefined;
}

function makeWhatsAppPlugin(getVault: () => VaultStore, hooks?: LifecycleHooks): Plugin {
  return definePlugin({
    name: '@moxxy/plugin-channel-whatsapp',
    version: '0.0.0',
    ...(hooks ? { hooks } : {}),
    channels: [
      defineChannel({
        name: 'whatsapp',
        description:
          'WhatsApp channel via Baileys — UNOFFICIAL API (violates WhatsApp ToS; the number ' +
          'can be banned — use a secondary number). QR device-link pairing, JID allow-list.',
        // Like Slack/Telegram: its own dedicated, isolated runner (separate
        // socket + sticky session) so the bot keeps a persistent history apart
        // from the user's desktop/TUI work. Baileys is an outbound WebSocket —
        // no tunnel, no tunnelProvider registration.
        dedicatedRunner: true,
        sessionSource: 'whatsapp',
        config: {
          fields: [
            {
              name: 'tosAcknowledged',
              label: "Risk acknowledgment — type 'yes'",
              vaultKey: WHATSAPP_CONSENT_KEY,
              required: true,
              help:
                'Unofficial WhatsApp API: violates the ToS and can get the number banned. ' +
                "Typing anything other than 'yes' keeps the channel disarmed.",
            },
            {
              name: 'allowedJids',
              label: 'Extra allowed JIDs (comma-separated)',
              vaultKey: WHATSAPP_ALLOWED_JIDS_KEY,
              required: false,
              placeholder: '15551234567@s.whatsapp.net',
              help: 'Your own Note-to-Self chat is always allowed once linked.',
            },
          ],
          hasRequestUrl: false,
          runHint:
            'On your phone: WhatsApp -> Settings -> Linked devices -> Link a device, then scan the QR.',
          connect: {
            kind: 'qr',
            title: 'Link WhatsApp',
            hint:
              'Scan with the phone that owns the account: WhatsApp -> Settings -> Linked devices ' +
              '-> Link a device. The QR refreshes periodically until scanned.',
          },
        },
        create: (deps) => {
          const options = deps.options;
          const allowedJids = readAllowedJids(options);
          const editFrameMs = options?.['editFrameMs'];
          const channelOpts: WhatsAppChannelOptions = {
            vault: getVault(),
            ...(allowedJids ? { allowedJids } : {}),
            ...(typeof editFrameMs === 'number' ? { editFrameMs } : {}),
            logger: deps.logger as never,
          };
          return new WhatsAppChannel(channelOpts);
        },
        isAvailable: async () => {
          // Cheap probes only: one vault read + one stat-shaped file read.
          let consent = false;
          try {
            consent = await hasConsent(getVault());
          } catch {
            // Vault unavailable in a probe/listing context; the env override
            // inside hasConsent(undefined) still counts.
            consent = await hasConsent(undefined);
          }
          if (!consent) return { ok: false, reason: CONSENT_REQUIRED_MESSAGE };
          const linked = await hasStoredCreds(
            createFileAuthStorage(moxxyPath(WHATSAPP_AUTH_DIR)),
          );
          if (!linked) {
            return {
              ok: false,
              reason:
                'No WhatsApp account linked (or the phone logged this device out). Run ' +
                '`moxxy channels whatsapp pair` to scan the QR.',
            };
          }
          return { ok: true };
        },
        interactiveCommand: 'setup',
        subcommands: {
          setup: {
            description:
              'Interactive setup: acknowledge the unofficial-API risk (required first step), ' +
              'link via QR, manage the allow-list, then start. Shown by default for ' +
              '`moxxy whatsapp` on a TTY.',
            run: async (ctx) => {
              if (process.stdin.isTTY !== true) {
                // Headless: the consent gate still holds — start refuses without
                // an acknowledgment (vault receipt or MOXXY_WHATSAPP_TOS_ACK).
                const vault = ctx.deps.vault as VaultStore | undefined;
                if (!(await hasConsent(vault))) {
                  process.stderr.write(`${CONSENT_REQUIRED_MESSAGE}\n`);
                  return 1;
                }
                return ctx.startChannel();
              }
              return runWhatsAppWizard(ctx);
            },
          },
          pair: {
            description:
              'Link a WhatsApp account: renders the rotating QR in the terminal; scan it from ' +
              'WhatsApp -> Settings -> Linked devices. Requires the typed risk acknowledgment.',
            run: async (ctx) => {
              if (process.stdin.isTTY !== true) {
                process.stderr.write(
                  'Pairing needs a TTY to show the QR. Run `moxxy channels whatsapp pair` on a ' +
                    'workstation, or pair from the desktop Channels panel.\n',
                );
                return 1;
              }
              return runWhatsAppPairFlow(ctx);
            },
          },
          status: {
            description:
              'Report consent/link/allow-list state as JSON (with re-pair guidance after a logout).',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const consentAcknowledged = await hasConsent(vault);
              const linked = await hasStoredCreds(
                createFileAuthStorage(moxxyPath(WHATSAPP_AUTH_DIR)),
              );
              const ownerJid = await vault.get(WHATSAPP_OWNER_JID_KEY);
              const allowedJids = parseAllowedJids(await vault.get(WHATSAPP_ALLOWED_JIDS_KEY));
              const state = !consentAcknowledged
                ? 'needs-consent'
                : !linked
                  ? 'needs-pairing'
                  : 'ready';
              const guidance = !consentAcknowledged
                ? 'Run `moxxy whatsapp setup` and type yes to acknowledge the unofficial-API risk.'
                : !linked
                  ? ownerJid
                    ? 'The phone logged this device out (or credentials were cleared) — run `moxxy channels whatsapp pair` to re-link.'
                    : 'Run `moxxy channels whatsapp pair` to link an account.'
                  : null;
              process.stdout.write(
                JSON.stringify(
                  { state, consentAcknowledged, linked, ownerJid, allowedJids, guidance },
                  null,
                  2,
                ) + '\n',
              );
              return 0;
            },
          },
          unpair: {
            description:
              'Forget the local WhatsApp credentials (also remove the device on the phone under Linked devices).',
            run: async (ctx) => {
              const vault = ctx.deps.vault as VaultStore | undefined;
              if (!vault) {
                process.stderr.write('vault unavailable\n');
                return 1;
              }
              const removed = await unpairLocal(vault);
              process.stdout.write(
                removed
                  ? 'unpaired — also remove the device on your phone: WhatsApp -> Settings -> Linked devices\n'
                  : 'no linked account was stored\n',
              );
              return 0;
            },
          },
        },
      }),
    ],
  });
}

/**
 * The desktop-runnable communication channels and the secrets each needs.
 *
 * A small static table, keyed by channel id (== the CLI subcommand). It maps
 * each config field to the vault key the channel plugin actually reads (the
 * single source of truth for those names is the plugin's own `keys.ts`; the few
 * lines are duplicated here so the desktop can render the config form + check
 * "configured" WITHOUT booting plugin discovery in the Electron main). When a
 * channel's vault keys change, update them here too. (Logged in TECH_DEBT: a
 * future `moxxy channels describe --json` could source this from the ChannelDef.)
 */

import type { ChannelDescriptor } from '@moxxy/desktop-ipc-contract';

export interface ChannelCatalogEntry {
  readonly descriptor: ChannelDescriptor;
  /** ChannelConfigField.name -> the vault key its value is stored under. */
  readonly vaultKeys: Readonly<Record<string, string>>;
  /** Vault keys that MUST be present for the channel to count as configured. */
  readonly requiredKeys: ReadonlyArray<string>;
}

export const CHANNEL_CATALOG: Readonly<Record<string, ChannelCatalogEntry>> = {
  slack: {
    descriptor: {
      id: 'slack',
      name: 'Slack',
      description:
        'A Slack bot that answers mentions in your workspace, running on its own dedicated runner. Ingests the Events API over the proxy relay.',
      docsUrl: 'https://api.slack.com/apps',
      configFields: [
        {
          name: 'botToken',
          label: 'Bot token',
          type: 'password',
          required: true,
          placeholder: 'xoxb-…',
          help: 'Slack app → OAuth & Permissions → Bot User OAuth Token',
        },
        {
          name: 'signingSecret',
          label: 'Signing secret',
          type: 'password',
          required: true,
          help: 'Slack app → Basic Information → App Credentials → Signing Secret',
        },
      ],
      hasWebhookUrl: true,
      runHint:
        'Paste the Request URL into your Slack app → Event Subscriptions, subscribe to the app_mention bot event, then mention the bot in a channel to pair.',
      connect: {
        kind: 'url',
        title: 'Request URL',
        hint: 'Paste this into your Slack app → Event Subscriptions, subscribe to the app_mention bot event, then mention the bot in a channel to pair.',
      },
    },
    vaultKeys: { botToken: 'slack_bot_token', signingSecret: 'slack_signing_secret' },
    requiredKeys: ['slack_bot_token', 'slack_signing_secret'],
  },
  telegram: {
    descriptor: {
      id: 'telegram',
      name: 'Telegram',
      description:
        'A Telegram bot (grammy long-polling) on its own dedicated runner. No public URL needed; pairs a chat via a one-time code.',
      docsUrl: 'https://core.telegram.org/bots#botfather',
      configFields: [
        {
          name: 'botToken',
          label: 'Bot token',
          type: 'password',
          required: true,
          placeholder: '123456:ABC-DEF…',
          help: 'Create a bot with @BotFather and paste its token',
        },
      ],
      hasWebhookUrl: false,
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
    vaultKeys: { botToken: 'telegram_bot_token' },
    requiredKeys: ['telegram_bot_token'],
  },
  signal: {
    descriptor: {
      id: 'signal',
      name: 'Signal',
      description:
        'A Signal linked device (signal-cli sidecar) on its own dedicated runner. Message your "Note to Self" to talk to moxxy; requires the signal-cli binary on PATH.',
      docsUrl: 'https://github.com/AsamK/signal-cli/wiki/Quickstart',
      configFields: [
        {
          name: 'account',
          label: 'Account number (E.164)',
          type: 'text',
          required: true,
          placeholder: '+15551234567',
          help: 'The Signal account moxxy links to as a secondary device',
        },
      ],
      hasWebhookUrl: false,
      runHint:
        'Scan the QR with your phone (Signal → Settings → Linked Devices → Link New Device); then message your own "Note to Self" to talk to moxxy.',
      connect: {
        kind: 'qr',
        title: 'Link your Signal',
        hint: 'On your phone: Signal → Settings → Linked Devices → Link New Device, then scan the QR.',
      },
    },
    vaultKeys: { account: 'signal_account' },
    requiredKeys: ['signal_account'],
  },
  whatsapp: {
    descriptor: {
      id: 'whatsapp',
      name: 'WhatsApp',
      description:
        'A WhatsApp bot via Baileys on its own dedicated runner. UNOFFICIAL API: automating an ' +
        'account violates WhatsApp\'s ToS and the number can be PERMANENTLY BANNED — use a ' +
        'secondary number. Links by QR (Linked devices); no public URL needed.',
      docsUrl: 'https://baileys.wiki',
      configFields: [
        {
          name: 'tosAcknowledged',
          label: "Risk acknowledgment — type 'yes'",
          type: 'text',
          required: true,
          help:
            "Typing anything other than 'yes' keeps the channel disarmed. This is the consent " +
            'gate for the unofficial-API ban risk.',
        },
        {
          name: 'allowedJids',
          label: 'Extra allowed JIDs (comma-separated)',
          type: 'text',
          required: false,
          placeholder: '15551234567@s.whatsapp.net',
          help: 'Your own Note-to-Self chat is always allowed once linked.',
        },
      ],
      hasWebhookUrl: false,
      runHint:
        'On your phone: WhatsApp -> Settings -> Linked devices -> Link a device, then scan the QR.',
      connect: {
        kind: 'qr',
        title: 'Link WhatsApp',
        hint:
          'Scan with the phone that owns the account: WhatsApp -> Settings -> Linked devices -> ' +
          'Link a device. The QR refreshes periodically until scanned.',
      },
    },
    vaultKeys: {
      tosAcknowledged: 'whatsapp_tos_acknowledged',
      allowedJids: 'whatsapp_allowed_jids',
    },
    requiredKeys: ['whatsapp_tos_acknowledged'],
  },
  discord: {
    descriptor: {
      id: 'discord',
      name: 'Discord',
      description:
        'A Discord bot (gateway WebSocket) on its own dedicated runner. No public URL needed; pairs an account via a DM code.',
      docsUrl: 'https://discord.com/developers/applications',
      configFields: [
        {
          name: 'botToken',
          label: 'Bot token',
          type: 'password',
          required: true,
          placeholder: 'MTIz…abc.def…',
          help: 'Developer Portal → your app → Bot → Reset Token. Enable the MESSAGE CONTENT privileged intent on the same page.',
        },
      ],
      hasWebhookUrl: false,
      runHint:
        'Open the invite link to add the bot to a server, then DM it — it replies with a one-time code; finish pairing with `moxxy discord pair` in a terminal.',
      connect: {
        kind: 'url',
        title: 'Invite the bot',
        hint: 'Open the link to invite the bot to your server, then DM it to receive a pairing code and finish with `moxxy discord pair`.',
        openable: true,
        openLabel: 'Open Discord authorization',
      },
    },
    vaultKeys: { botToken: 'discord_bot_token' },
    requiredKeys: ['discord_bot_token'],
  },
};

/** Every catalog entry, in display order. */
export function listChannelCatalog(): ReadonlyArray<ChannelCatalogEntry> {
  return Object.values(CHANNEL_CATALOG);
}

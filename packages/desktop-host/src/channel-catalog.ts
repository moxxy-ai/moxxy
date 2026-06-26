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
        'Message your bot on Telegram, then send the pairing code it replies with to authorize your chat.',
    },
    vaultKeys: { botToken: 'telegram_bot_token' },
    requiredKeys: ['telegram_bot_token'],
  },
};

/** Every catalog entry, in display order. */
export function listChannelCatalog(): ReadonlyArray<ChannelCatalogEntry> {
  return Object.values(CHANNEL_CATALOG);
}

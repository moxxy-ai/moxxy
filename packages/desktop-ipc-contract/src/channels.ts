// ---------- Communication channels (Slack / Telegram, run from desktop) ----
//
// Let the desktop user run a chat channel (Slack, Telegram) on its OWN dedicated,
// isolated runner — configure its secrets, start/stop it, and (for Slack) see the
// public Request URL to paste into the provider's app config. The host spawns
// `moxxy <channelId>` as a supervised dedicated-runner subprocess; these shapes are
// the renderer-facing contract for that. Host-only (NOT remote-allowed): running a
// local subprocess is a desktop operation, like the apps gallery.

/** One secret/setting a channel needs, rendered as a labelled form field. */
export interface ChannelConfigField {
  /** Logical field id the renderer keys its form value by (e.g. `botToken`). */
  readonly name: string;
  /** Human label (e.g. `Bot token`). */
  readonly label: string;
  /** `password` masks the input + is write-only; `text` is shown back. */
  readonly type: 'password' | 'text';
  readonly placeholder?: string;
  readonly required?: boolean;
  /** Optional one-line hint (e.g. where to find the value). */
  readonly help?: string;
}

/** Static description of a runnable channel (its identity + what it needs). */
export interface ChannelDescriptor {
  /** Channel id == the CLI subcommand (`slack`, `telegram`). */
  readonly id: string;
  /** Display name (`Slack`). */
  readonly name: string;
  readonly description: string;
  /** Icon name the renderer maps to its icon set. */
  readonly icon?: string;
  /** Optional setup docs link. */
  readonly docsUrl?: string;
  /** The secrets/settings the user must provide before it can start. */
  readonly configFields: ReadonlyArray<ChannelConfigField>;
  /** True when the channel exposes a public ingest URL once running (Slack);
   *  false for poll-based channels (Telegram). Drives the URL affordance. */
  readonly hasWebhookUrl: boolean;
  /** Guidance shown once the channel is running (e.g. "paste the Request URL
   *  into Slack → Event Subscriptions, then mention the bot to pair"). */
  readonly runHint?: string;
}

/** Live runtime status of a channel's dedicated runner. */
export interface ChannelRuntimeStatus {
  readonly id: string;
  /** Every required secret is present in the vault. */
  readonly configured: boolean;
  /** The dedicated-runner subprocess is currently up. */
  readonly running: boolean;
  readonly pid?: number;
  readonly startedAtMs?: number;
  /** Public ingest URL once the tunnel is up (Slack); absent otherwise. */
  readonly requestUrl?: string;
  /** Last spawn/runtime error, surfaced so the UI can show why it stopped. */
  readonly error?: string;
}

/** A channel descriptor paired with its live status, as `channels.list` returns. */
export interface ChannelEntry {
  readonly descriptor: ChannelDescriptor;
  readonly status: ChannelRuntimeStatus;
}

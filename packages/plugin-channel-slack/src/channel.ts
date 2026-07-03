import { newTurnId } from '@moxxy/core';
import { TofuPairingWindow, TurnCoordinator } from '@moxxy/channel-kit';
import { proxyTunnel } from '@moxxy/plugin-tunnel-proxy';
import type { ClientSession as Session } from '@moxxy/sdk';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  MoxxyEvent,
  PermissionResolver,
  TunnelHandle,
  TunnelProviderDef,
} from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  SLACK_AUTHORIZED_KEY,
  authorizationMatches,
  parseAuthorization,
  resolveBotToken,
  resolveSigningSecret,
  type SlackAuthorization,
} from './keys.js';
import { buildSlackPermissionResolver } from './permission.js';
import { SlackClient } from './channel/slack-client.js';
import { runSlackTurn } from './channel/turn-runner.js';
import {
  IngestServer,
  SLACK_EVENTS_PATH,
  type DispatchContext,
} from './server/ingest-server.js';
import type { SlackEventCallback } from './server/schema.js';

/** Routing label the proxy relay exposes this channel under. */
const TUNNEL_LABEL = 'slack';

export interface SlackChannelLogger {
  debug?(msg: string, meta?: Record<string, unknown>): void;
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

export interface SlackChannelOptions {
  readonly vault: VaultStore;
  /**
   * Tunnel provider used to expose the local ingest server publicly. Defaults to
   * the self-hosted `proxyTunnel` (imported directly, like the webhooks tunnel);
   * tests pass a fake provider so they never hit the network.
   */
  readonly tunnelProvider?: TunnelProviderDef;
  /** Tools the model may call autonomously. `['*']` allows every registered tool. */
  readonly allowedTools?: ReadonlyArray<string>;
  /** Debounce window for streaming `chat.update` edits (ms). Default 1000. */
  readonly editFrameMs?: number;
  /** Bind host for the local ingest server. Default 127.0.0.1. */
  readonly host?: string;
  readonly logger?: SlackChannelLogger;
  /** Injectable Slack client factory (tests). */
  readonly makeClient?: (token: string) => SlackClient;
}

export interface SlackStartOpts extends ChannelStartOptsBase {
  readonly session: Session;
  /**
   * If true, arm a TOFU pairing window: the first verified inbound event from a
   * team/channel is captured and (via `onPairConfirm`) persisted to the vault.
   */
  readonly pair?: boolean;
  /** Override allowedTools at start (the CLI forwards channel config / flags). */
  readonly allowedTools?: ReadonlyArray<string>;
}

/** Fires when a verified event lands during a pairing window. */
export interface PairCandidate {
  readonly teamId: string;
  readonly channelId: string;
}

export class SlackChannel implements Channel<SlackStartOpts> {
  readonly name = 'slack';
  /**
   * Installed on the session by the CLI dispatcher. Replaced in `start()` once
   * we can expand a `['*']` allow-list against the live tool registry; until
   * then it denies everything (safe default before start).
   */
  permissionResolver: PermissionResolver;

  private readonly opts: SlackChannelOptions;
  private session: Session | null = null;
  private client: SlackClient | null = null;
  private ingest: IngestServer | null = null;
  private tunnel: TunnelHandle | null = null;
  private handle: ChannelHandle | null = null;
  private resolveRunning: (() => void) | null = null;

  private botUserId = '';
  private authorization: SlackAuthorization | null = null;
  private model: string | undefined;

  // Single-flight turn state (v1: one turn at a time across all threads): the
  // `busy` guard, the per-turn AbortController, and the bounded own-turn-id set
  // mirrorForeignTurn filters on (#8).
  private readonly turns = new TurnCoordinator();
  // Per-turn target so foreign-turn mirroring + permission prompts know the thread.
  private currentChannelId: string | null = null;
  private currentThreadTs: string | null = null;
  private lastChannelId: string | null = null;
  private lastThreadTs: string | null = null;
  private logUnsub: (() => void) | null = null;

  // Pairing (TOFU) window: armed by `start({ pair: true })`, captures the first
  // verified team/channel for the pair flow to confirm.
  private readonly tofu: TofuPairingWindow<PairCandidate>;
  private publicUrl: string | null = null;

  constructor(opts: SlackChannelOptions) {
    this.opts = opts;
    this.tofu = new TofuPairingWindow<PairCandidate>({
      onListenerError: (err) =>
        this.opts.logger?.warn?.('slack: pair listener threw', { err: String(err) }),
    });
    // Pre-start: deny-all. Replaced with the real allow-list resolver in start()
    // once the tool registry is available (for `['*']` expansion).
    this.permissionResolver = buildSlackPermissionResolver({
      allowedTools: [],
      allToolNames: [],
      ...(opts.logger ? { logger: opts.logger } : {}),
    });
  }

  /** The public Request URL to paste into Slack's Event Subscriptions. */
  get requestUrl(): string | null {
    return this.publicUrl;
  }

  /** Subscribe to pairing candidates (the setup/pair flows use this). */
  onPairCandidate(listener: (c: PairCandidate) => void): () => void {
    return this.tofu.onCandidate(listener);
  }

  /** Persist a team/channel as authorized (called by the pair flow on confirm). */
  async confirmPairing(candidate: PairCandidate): Promise<void> {
    const auth: SlackAuthorization = {
      teamId: candidate.teamId,
      channelId: candidate.channelId,
    };
    await this.opts.vault.set(SLACK_AUTHORIZED_KEY, JSON.stringify(auth), ['slack']);
    this.authorization = auth;
    this.tofu.disarm();
  }

  async start(startOpts: SlackStartOpts): Promise<ChannelHandle> {
    if (this.handle) return this.handle;
    this.session = startOpts.session;
    this.model = startOpts.model;
    if (startOpts.pair === true) this.tofu.arm();

    const token = await resolveBotToken(this.opts.vault);
    if (!token) {
      throw new Error(
        'Slack bot token not found. Run `moxxy channels slack setup`, set MOXXY_SLACK_BOT_TOKEN, ' +
          'or store one in the vault under slack_bot_token.',
      );
    }
    const signingSecret = await resolveSigningSecret(this.opts.vault);
    if (!signingSecret) {
      throw new Error(
        'Slack signing secret not found. Run `moxxy channels slack setup`, set ' +
          'MOXXY_SLACK_SIGNING_SECRET, or store one in the vault under slack_signing_secret.',
      );
    }

    // Load any persisted pairing.
    this.authorization = parseAuthorization(await this.opts.vault.get(SLACK_AUTHORIZED_KEY));
    if (!this.tofu.isArmed && !this.authorization) {
      throw new Error(
        'No Slack team/channel is paired yet. Run `moxxy channels slack pair` first.',
      );
    }

    // Validate the token + capture the bot's own user id (for self-message drops).
    this.client = this.opts.makeClient
      ? this.opts.makeClient(token)
      : new SlackClient({ token });
    const auth = await this.client.authTest();
    this.botUserId = auth.botUserId;
    this.opts.logger?.info?.('slack: authenticated', {
      botUserId: this.botUserId,
      team: auth.team,
    });

    // Build the real allow-list resolver now that the tool registry is live, so
    // `['*']` can expand to every registered tool name (mirror prompt.ts).
    const allowedTools = startOpts.allowedTools ?? this.opts.allowedTools ?? [];
    const allToolNames = this.session.tools.list().map((t) => t.name);
    this.permissionResolver = buildSlackPermissionResolver({
      allowedTools,
      allToolNames,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
    // Swap the (now-final) resolver in — start() was called AFTER the CLI
    // installed the pre-start one, so re-install via the documented seam.
    this.session.setPermissionResolver(this.permissionResolver);

    // Mirror-to-thread: post the assistant's prose for a turn this channel did
    // NOT initiate (e.g. a co-attached surface ran one) into the last thread we
    // served. Our OWN turns stream via the frame pump (filtered by turnId).
    this.logUnsub = this.session.log.subscribe((event) => this.mirrorForeignTurn(event));

    // Stand up the local ingest server, then expose it via the proxy tunnel.
    this.ingest = new IngestServer({
      ...(this.opts.host ? { host: this.opts.host } : {}),
      signingSecret,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
      hooks: {
        botUserId: this.botUserId,
        isAuthorized: (teamId, channel) =>
          authorizationMatches(this.authorization, teamId, channel),
        onVerifiedEvent: (ev) => this.handlePairingCandidate(ev),
        dispatch: (ctx) => this.dispatchTurn(ctx),
      },
    });
    const bound = await this.ingest.start();

    await this.openTunnel(bound.host, bound.port);

    const running = new Promise<void>((resolve) => {
      this.resolveRunning = resolve;
    });

    this.handle = {
      running,
      stop: async (reason = 'shutdown') => {
        // Abort the in-flight turn FIRST so the model loop stops the moment the
        // operator asks to shut down (shared/remote Session: spend continues
        // otherwise and only its output is discarded).
        this.turns.abort(reason);
        this.logUnsub?.();
        this.logUnsub = null;
        if (this.tunnel) {
          try { await this.tunnel.close(); } catch { /* ignore */ }
          this.tunnel = null;
        }
        if (this.ingest) {
          await this.ingest.stop();
          this.ingest = null;
        }
        this.publicUrl = null;
        this.resolveRunning?.();
        this.resolveRunning = null;
      },
    };
    this.opts.logger?.info?.('slack: channel started', {
      requestUrl: this.publicUrl,
      paired: this.authorization != null,
      pairing: this.tofu.isArmed,
    });
    return this.handle;
  }

  private async openTunnel(host: string, port: number): Promise<void> {
    // Default to the self-hosted proxy relay (imported directly, like the
    // webhooks tunnel); tests inject a fake provider.
    const provider = this.opts.tunnelProvider ?? proxyTunnel;
    if (provider.name === 'localhost') {
      // A no-op provider can't reach a loopback port from Slack. Surface the
      // local URL so a manual reverse proxy can still be wired.
      this.publicUrl = `http://${host}:${port}${SLACK_EVENTS_PATH}`;
      this.opts.logger?.warn?.(
        'slack: localhost tunnel provider — Slack cannot reach a loopback port',
        { localUrl: this.publicUrl },
      );
      return;
    }
    try {
      this.tunnel = await provider.open({ port, host, label: TUNNEL_LABEL });
      this.publicUrl = `${this.tunnel.url.replace(/\/+$/, '')}${SLACK_EVENTS_PATH}`;
      this.opts.logger?.info?.('slack: tunnel open', {
        provider: provider.name,
        requestUrl: this.publicUrl,
      });
    } catch (err) {
      this.publicUrl = `http://${host}:${port}${SLACK_EVENTS_PATH}`;
      this.opts.logger?.warn?.('slack: tunnel failed; using local URL', {
        provider: provider.name,
        err: String(err),
      });
    }
  }

  /**
   * TOFU pairing hook: while a pairing window is armed, the first verified event
   * captures the team/channel and notifies listeners. It's "consumed" (no turn)
   * so the very first message just establishes trust. Returns true when consumed.
   */
  private handlePairingCandidate(ev: SlackEventCallback): boolean {
    if (!this.tofu.isArmed) return false;
    const teamId = ev.team_id;
    const channelId = ev.event.channel;
    if (!teamId || !channelId) return false;
    return this.tofu.offer({ teamId, channelId });
  }

  /**
   * Fire-and-forget a turn for an authorized event. Single-flight (v1): if a
   * turn is already running we drop the new event with a thread reply rather
   * than corrupting the per-turn state. The ingest handler has already ACKed.
   */
  private dispatchTurn(ctx: DispatchContext): void {
    void this.runTurn(ctx).catch((err) => {
      this.opts.logger?.warn?.('slack: turn dispatch failed', { err: String(err) });
    });
  }

  private async runTurn(ctx: DispatchContext): Promise<void> {
    if (!this.session || !this.client) return;
    // The turnId is minted here so the coordinator records it as an own-turn id
    // — that's what mirrorForeignTurn filters on (#8).
    const lease = this.turns.begin(newTurnId());
    if (!lease) {
      // Politely decline; v1 has no per-thread concurrency (see TECH_DEBT).
      try {
        await this.client.postMessage({
          channel: ctx.channel,
          threadTs: ctx.threadTs,
          text: 'I am still working on a previous request. One moment…',
        });
      } catch { /* ignore */ }
      return;
    }
    this.currentChannelId = ctx.channel;
    this.currentThreadTs = ctx.threadTs;
    this.lastChannelId = ctx.channel;
    this.lastThreadTs = ctx.threadTs;

    try {
      await runSlackTurn(
        {
          session: this.session,
          client: this.client,
          editFrameMs: this.opts.editFrameMs ?? 1000,
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
        },
        {
          channel: ctx.channel,
          threadTs: ctx.threadTs,
          text: ctx.text,
          ...(this.model ? { model: this.model } : {}),
          controller: lease.controller,
          turnId: lease.turnId,
        },
      );
    } finally {
      lease.end();
      this.currentChannelId = null;
      this.currentThreadTs = null;
    }
  }

  /**
   * Post the assistant's prose for a turn this channel did not initiate. Gated by
   * `!busy` (our own turns stream via the frame pump) and by having served a
   * thread at least once. Skipped for our own turnIds (robust to async ordering /
   * replay, invariant #8).
   */
  private mirrorForeignTurn(event: MoxxyEvent): void {
    // Skipped for our own turnIds (robust to async ordering / replay, #8) and
    // while a turn of ours is streaming via the frame pump.
    const text = this.turns.mirrorText(event);
    if (text == null) return;
    if (!this.client || this.lastChannelId == null || this.lastThreadTs == null) return;
    void this.client
      .postMessage({ channel: this.lastChannelId, threadTs: this.lastThreadTs, text })
      .catch((err) => {
        this.opts.logger?.warn?.('slack: mirror failed', { err: String(err) });
      });
  }
}

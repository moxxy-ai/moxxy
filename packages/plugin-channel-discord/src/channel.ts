import { Buffer } from 'node:buffer';
import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Interaction,
  type Message,
} from 'discord.js';
import { newTurnId } from '@moxxy/core';
import { TurnCoordinator, deliverVoiceReply, resolveVoiceToggle } from '@moxxy/channel-kit';
import type { ClientSession as Session } from '@moxxy/sdk';
import type {
  ApprovalRequest,
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  MoxxyEvent,
  PendingToolCall,
  PermissionContext,
} from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { DiscordPermissionResolver } from './permission.js';
import { DiscordApprovalResolver } from './approval.js';
import {
  resolveBotToken,
  DISCORD_TOKEN_KEY,
  loadVoiceReplies,
  saveVoiceReplies,
} from './keys.js';
import { extractInboundMessage } from './schema.js';
import { splitForDiscord } from './render.js';
import { AllowListStore } from './channel/allow-list-store.js';
import type { ChannelLogger, SendableChannelLike } from './channel/discord-like.js';
import {
  handleInboundMessage,
  performSessionAction,
  type AwaitingApprovalText,
  type InboundContext,
} from './channel/message-handler.js';
import { handleInteraction, type InteractionLike } from './channel/interaction-handler.js';
import { PairingHandler, type PairingConfirmResult } from './channel/pairing-handler.js';
import { askForPermission } from './channel/permission-prompt.js';
import { askForApproval } from './channel/approval-prompt.js';
import { publishAppCommands } from './channel/slash-handler.js';
import { clampEditFrameMs, runDiscordTurn } from './channel/turn-runner.js';
import { handleVoiceMessage } from './channel/voice-handler.js';
import { TypingIndicator } from './channel/typing-indicator.js';

/** Cap on waiting for the gateway READY event (bot identity → invite link).
 *  Identity resolution must never wedge `start()`; on timeout we proceed
 *  without the invite URL and the gateway surfaces real token errors itself. */
const READY_TIMEOUT_MS = 15_000;

/** Minimal permission bits for the invite link: View Channels + Send Messages
 *  + Read Message History. */
const INVITE_PERMISSIONS = 1024 + 2048 + 65536;

/**
 * Install guidance shown when enabling `/voice` with no active synthesizer —
 * mirrors the voice-handler's transcriber guidance wording, pointing at the TTS
 * plugin instead of the STT one.
 */
const VOICE_NO_SYNTH_HINT =
  'No text-to-speech backend is configured yet, so replies stay text-only. Install one with `moxxy plugins install tts-openai` and run `moxxy login openai` (or set OPENAI_API_KEY) to enable spoken replies.';

export type { PairingConfirmResult } from './channel/pairing-handler.js';

export interface DiscordStartOpts extends ChannelStartOptsBase {
  readonly session: Session;
  /**
   * If true (and no account is paired yet), arm the DM pairing window on
   * startup: an unauthorized user who DMs the bot is issued a one-time code,
   * and the terminal `moxxy discord pair` flow confirms the pasted code. Set
   * by the `pair` subcommand.
   */
  readonly pair?: boolean;
  /**
   * The channel is running on its own dedicated runner under a GUI control
   * surface (the desktop Channels panel). Arms the same pairing window as
   * `pair` for the unpaired case so DM-ing users at least receive codes —
   * completing the paste still needs the terminal `moxxy discord pair` flow.
   */
  readonly dedicated?: boolean;
}

export interface DiscordChannelOptions {
  readonly vault: VaultStore;
  readonly token?: string;
  readonly logger?: ChannelLogger;
  /** Streaming edit throttle; clamped to ≥1200ms (Discord's ~5 edits/5s per
   *  channel rate limit). */
  readonly editFrameMs?: number;
}

export class DiscordChannel implements Channel<DiscordStartOpts> {
  readonly name = 'discord';
  readonly permissionResolver: DiscordPermissionResolver;
  readonly approvalResolver: DiscordApprovalResolver;
  private readonly opts: DiscordChannelOptions;
  private readonly editFrameMs: number;
  private client: Client | null = null;
  private botUserId: string | null = null;
  // The bot's OAuth2 invite URL (resolved from the application id after the
  // gateway READY), published as this channel's `requestUrl` connect value so
  // control surfaces can render an "invite the bot" step. Null until resolved.
  private inviteUrl: string | null = null;
  private readonly connectListeners = new Set<() => void>();
  // Channel the CURRENT turn runs in (target for permission/approval prompts).
  private currentChannel: SendableChannelLike | null = null;
  // Last channel we served — the target for mirroring foreign turns.
  private lastChannel: SendableChannelLike | null = null;
  private logUnsub: (() => void) | null = null;
  private session: Session | null = null;
  private model: string | undefined;
  private yolo = false;
  // When true, the final assistant reply of each turn is also synthesized (via
  // the session's active Synthesizer) and sent as an audio attachment.
  // Persisted per paired account in the vault (`discord_voice_replies`),
  // toggled with `/voice`.
  private voiceReplies = false;
  // Single-flight turn state: `busy` guard, per-turn AbortController (so
  // /cancel aborts only the current turn), and the bounded own-turn-id set
  // that mirrorForeignTurn filters on (AGENTS.md invariant #8).
  private readonly turns = new TurnCoordinator();
  private awaitingApprovalText: AwaitingApprovalText | null = null;
  private handle: ChannelHandle | null = null;
  private readonly typing = new TypingIndicator();
  private readonly pairing: PairingHandler;
  private readonly allowList: AllowListStore;
  // Rate-limit the "dropped invalid payload" warning so a hostile sender
  // can't turn the log into a firehose.
  private lastInvalidWarnAt = 0;

  constructor(opts: DiscordChannelOptions) {
    this.opts = opts;
    this.editFrameMs = clampEditFrameMs(opts.editFrameMs);
    this.permissionResolver = new DiscordPermissionResolver();
    this.approvalResolver = new DiscordApprovalResolver();
    this.pairing = new PairingHandler({
      vault: opts.vault,
      ...(opts.logger ? { logger: opts.logger } : {}),
    });
    this.allowList = new AllowListStore(opts.vault);
    // A completed pairing flips this channel's connect-state to "connected".
    this.pairing.onPaired((userId) => {
      this.notifyConnectChange();
      this.greetPairedUser(userId);
    });
  }

  /** This channel's connect value (see {@link Channel.requestUrl}): the bot's
   *  OAuth2 invite URL, surfaced by control surfaces as an "invite the bot"
   *  step. */
  get requestUrl(): string | null {
    return this.inviteUrl;
  }

  /** Whether an account is paired (see {@link Channel.connected}). */
  get connected(): boolean {
    return this.pairing.phase() === 'paired';
  }

  pairingPhase(): ReturnType<PairingHandler['phase']> {
    return this.pairing.phase();
  }

  unpair(): void {
    this.pairing.unpair();
  }

  /** Subscribe to "an account just paired" (fires once per completed pairing).
   *  Returns an unsubscribe function. */
  onPaired(listener: (userId: string) => void): () => void {
    return this.pairing.onPaired(listener);
  }

  /** The terminal pair flow submits the operator-pasted code here. */
  confirmPairingCode(rawCode: string): Promise<PairingConfirmResult> {
    return this.pairing.confirmCode(rawCode);
  }

  async start(startOpts: DiscordStartOpts): Promise<ChannelHandle> {
    if (this.handle) return this.handle;
    this.session = startOpts.session;
    this.model = startOpts.model;

    // Precedence mirrors the other channels (and this channel's isAvailable
    // gate): explicit option, then MOXXY_DISCORD_TOKEN, then the vault.
    const token = this.opts.token ?? (await resolveBotToken(this.opts.vault));
    if (!token) {
      throw new Error(
        `Discord bot token not found. Store one via vault_set('${DISCORD_TOKEN_KEY}', ...) or set MOXXY_DISCORD_TOKEN.`,
      );
    }
    await this.pairing.loadAuthorized();
    await this.allowList.load();
    this.voiceReplies = await loadVoiceReplies(this.opts.vault);

    // Arm the DM pairing window when a pairing surface asked for it (`pair`)
    // OR when running GUI-supervised on a dedicated runner and nothing is
    // paired yet. A headless start with neither signal errors with a hint.
    const dedicated = startOpts.dedicated === true || process.env.MOXXY_DEDICATED_RUNNER === '1';
    if (this.pairing.phase() !== 'paired') {
      if (startOpts.pair || dedicated) {
        this.pairing.arm();
        this.opts.logger?.info?.('discord pairing window armed');
      } else {
        throw new Error(
          'No Discord account is paired yet. Run `moxxy discord pair`, DM the bot, and paste the code it replies with.',
        );
      }
    }

    // MessageContent is a PRIVILEGED intent — the setup wizard tells the user
    // to enable it in the Developer Portal; without it every guild message
    // arrives with empty content. Partials.Channel is required for DMs (they
    // are not cached when the first event for them arrives).
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    this.client = client;
    this.permissionResolver.setDecider((call, ctx) => this.askForPermission(call, ctx));
    this.approvalResolver.setDecider((id, request) => this.askForApproval(id, request));
    // Register the approval resolver on the session so loop strategies
    // (plan-execute) surface their validation dialog on this channel;
    // stop() tears it down so headless paths never see a stale handler.
    this.session.setApprovalResolver(this.approvalResolver);

    // Mirror-to-both: when the session runs a turn this channel did NOT
    // initiate (e.g. a co-attached web surface), post the assistant's prose
    // into the last channel we served. Our OWN turns render via the pump.
    this.logUnsub = this.session.log.subscribe((event) => this.mirrorForeignTurn(event));

    // discord.js does not await event handlers, but we still fire-and-track so
    // rejections are logged (they would otherwise be unhandled rejections).
    client.on(Events.MessageCreate, (message) =>
      this.dispatchInBackground(this.handleMessage(message), 'message'),
    );
    client.on(Events.InteractionCreate, (interaction) =>
      this.dispatchInBackground(this.handleInteractionEvent(interaction), 'interaction'),
    );
    client.on(Events.Error, (err) => {
      this.opts.logger?.warn('discord client error', { err: String(err) });
    });

    // Resolve the bot's identity (application id → invite URL, own user id)
    // from the READY event, BOUNDED so a slow gateway can't wedge start() —
    // on timeout we proceed without the invite link (mirrors Telegram's getMe
    // timeout). `login` itself rejects fast on an invalid token.
    const ready = new Promise<void>((resolve) => {
      client.once(Events.ClientReady, () => resolve());
    });
    await client.login(token);
    const readyTimer = new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error(`gateway READY timed out after ${READY_TIMEOUT_MS}ms`)),
        READY_TIMEOUT_MS,
      );
      t.unref?.();
    });
    try {
      await Promise.race([ready, readyTimer]);
      this.botUserId = client.user?.id ?? null;
      const appId = client.application?.id ?? null;
      if (appId) {
        this.inviteUrl = `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`;
      }
      // Surface the shared registry commands in Discord's "/" picker. Best
      // effort — a failure never blocks startup (text commands still work).
      const commands = client.application?.commands;
      void publishAppCommands(
        commands ? { set: (defs) => commands.set([...defs]) } : null,
        this.session,
        this.opts.logger,
      );
    } catch (err) {
      this.opts.logger?.warn('discord: could not resolve bot identity (READY timeout)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.opts.logger?.info?.('discord channel starting', {
      paired: this.pairing.phase() === 'paired',
    });

    // The gateway has no "runs until stopped" promise; resolve on stop().
    let resolveRunning: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      resolveRunning = resolve;
    });
    this.handle = {
      running,
      onConnectChange: (listener) => {
        this.connectListeners.add(listener);
        return () => this.connectListeners.delete(listener);
      },
      stop: async (reason = 'shutdown') => {
        // Abort the in-flight turn FIRST so the model loop stops generating /
        // executing the moment the operator asks to shut down; then reject
        // pending prompts so no caller hangs (audit: TuiChannel.stop hang).
        this.turns.abort(reason);
        this.permissionResolver.abortAll(reason);
        this.approvalResolver.abortAll(reason);
        this.logUnsub?.();
        this.logUnsub = null;
        if (this.session) this.session.setApprovalResolver(null);
        this.typing.stop();
        if (this.client) {
          await this.client.destroy().catch(() => undefined);
          this.client = null;
        }
        resolveRunning();
      },
    };
    return this.handle;
  }

  private notifyConnectChange(): void {
    for (const listener of this.connectListeners) {
      try {
        listener();
      } catch (err) {
        this.opts.logger?.warn('discord connect-change listener threw', { err: String(err) });
      }
    }
  }

  /** DM a confirmation to the freshly paired account. Best-effort. */
  private greetPairedUser(userId: string): void {
    const client = this.client;
    if (!client) return;
    void client.users
      .fetch(userId)
      .then((user) => user.send('✅ Paired with moxxy. Send a prompt to begin.'))
      .catch((err) => {
        this.opts.logger?.warn('discord pairing greeting failed', { err: String(err) });
      });
  }

  /**
   * Run a handler promise detached from the event dispatch. Errors are logged
   * here — discord.js does not surface handler rejections anywhere useful.
   */
  private dispatchInBackground(work: Promise<void>, kind: string): void {
    void work.catch((err) => {
      this.opts.logger?.warn('discord handler failed', { kind, err: String(err) });
    });
  }

  private async handleMessage(raw: Message): Promise<void> {
    // Boundary validation (invariant A8): extract ONLY the fields we consume
    // and zod-validate them; drop invalid/oversized payloads with a
    // rate-limited warning.
    const msg = extractInboundMessage(raw);
    if (!msg) {
      const now = Date.now();
      if (now - this.lastInvalidWarnAt > 10_000) {
        this.lastInvalidWarnAt = now;
        this.opts.logger?.warn('discord: dropped invalid inbound message payload');
      }
      return;
    }
    const channel = raw.channel as unknown as { send?: unknown };
    if (typeof channel.send !== 'function') return;
    const ctx: InboundContext = {
      msg,
      channel: raw.channel as unknown as SendableChannelLike,
      reply: (text) => raw.reply(text),
    };
    const deps = {
      pairing: this.pairing,
      allowList: this.allowList,
      approvalResolver: this.approvalResolver,
      permissionResolver: this.permissionResolver,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    };
    await handleInboundMessage(
      ctx,
      {
        session: this.session,
        busy: this.turns.busy,
        turnController: this.turns.controller,
        awaitingApprovalText: this.awaitingApprovalText,
        handle: this.handle,
        botUserId: this.botUserId,
      },
      deps,
      {
        setAwaitingApprovalText: (state) => {
          this.awaitingApprovalText = state;
        },
        toggleYolo: () => {
          this.yolo = !this.yolo;
          return this.yolo;
        },
        setYolo: (value) => {
          this.yolo = value;
        },
        voice: (arg) => this.voiceCommand(arg),
        runUserTurn: (c, text) => this.runUserTurn(c, text),
        runVoiceMessage: (c) =>
          handleVoiceMessage(
            c,
            { session: this.session, busy: this.turns.busy },
            this.opts.logger ? { logger: this.opts.logger } : {},
            { runUserTurn: (cc, text) => this.runUserTurn(cc, text) },
          ),
      },
    );
  }

  private async handleInteractionEvent(interaction: Interaction): Promise<void> {
    await handleInteraction(
      interaction as unknown as InteractionLike,
      { session: this.session, turnController: this.turns.controller },
      {
        pairing: this.pairing,
        allowList: this.allowList,
        permissionResolver: this.permissionResolver,
        approvalResolver: this.approvalResolver,
        ...(this.opts.logger ? { logger: this.opts.logger } : {}),
      },
      {
        setAwaitingApprovalText: (state) => {
          this.awaitingApprovalText = state;
        },
        toggleYolo: () => {
          this.yolo = !this.yolo;
          return this.yolo;
        },
        voice: (arg) => this.voiceCommand(arg),
        performSessionAction: (action, notice) =>
          performSessionAction(
            action,
            notice,
            {
              session: this.session,
              turnController: this.turns.controller,
              handle: this.handle,
            },
            {
              approvalResolver: this.approvalResolver,
              permissionResolver: this.permissionResolver,
            },
            {
              setAwaitingApprovalText: (state) => {
                this.awaitingApprovalText = state;
              },
              setYolo: (value) => {
                this.yolo = value;
              },
            },
          ),
      },
    );
  }

  private async runUserTurn(ctx: InboundContext, text: string): Promise<void> {
    if (!this.session) throw new Error('DiscordChannel.start() must be called first');
    // Atomic single-flight guard: `begin` claims the slot synchronously so a
    // concurrently dispatched second turn can't slip past the busy check. The
    // turnId is minted here so the coordinator records it as an own-turn id
    // (mirrorForeignTurn filters on those).
    const lease = this.turns.begin(newTurnId());
    if (!lease) {
      await ctx.reply('I am still working on the previous prompt. Send /cancel to abort it.');
      return;
    }
    this.currentChannel = ctx.channel;
    this.lastChannel = ctx.channel;
    try {
      await runDiscordTurn(
        {
          session: this.session,
          channel: ctx.channel,
          typing: this.typing,
          editFrameMs: this.editFrameMs,
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
          onFinalReply: (finalText) => this.sendVoiceReply(ctx.channel, finalText),
        },
        { text, model: this.model, controller: lease.controller, turnId: lease.turnId },
      );
    } finally {
      lease.end();
      this.currentChannel = null;
    }
  }

  /** Handle `/voice [on|off|status]`: persist + apply the preference, return the
   *  reply text. Shared by the plain-text and application-command paths. */
  private async voiceCommand(arg: string): Promise<string> {
    const result = resolveVoiceToggle({
      arg,
      enabled: this.voiceReplies,
      hasSynthesizer: this.session?.synthesizers.tryGetActive() != null,
      delivery: 'an audio file',
      noSynthesizerHint: VOICE_NO_SYNTH_HINT,
    });
    if (result.persist) await this.setVoiceReplies(result.enabled);
    return result.reply;
  }

  private async setVoiceReplies(on: boolean): Promise<void> {
    this.voiceReplies = on;
    try {
      await saveVoiceReplies(this.opts.vault, on);
    } catch (err) {
      this.opts.logger?.warn('discord voice-replies persist failed', { err: String(err) });
    }
  }

  /**
   * Attach the final assistant reply as synthesized audio, when enabled.
   * Best-effort and fully isolated (never throws): synthesize via the session's
   * active Synthesizer, transcode to OGG/Opus (or send the original format when
   * ffmpeg is unavailable), and post as a file. The text reply already went out.
   *
   * NB: a plain audio attachment, not a true Discord voice-message bubble
   * (MessageFlags.IsVoiceMessage + waveform) — deferred to a follow-up.
   */
  private async sendVoiceReply(channel: SendableChannelLike, text: string): Promise<void> {
    if (!this.voiceReplies || !this.session) return;
    const outcome = await deliverVoiceReply(this.session, text, {
      send: async (audio, meta) => {
        await channel.send({
          files: [new AttachmentBuilder(Buffer.from(audio), { name: meta.filename })],
        });
      },
    });
    if (outcome.status === 'failed') {
      this.opts.logger?.warn('discord voice reply failed', {
        reason: outcome.reason,
        ...(outcome.error ? { err: outcome.error } : {}),
      });
    }
  }

  /**
   * Post the assistant's prose for a turn this channel did not initiate. The
   * coordinator skips turns THIS channel started, by turnId (invariant #8),
   * and yields the trimmed prose; we only need a served channel to post into.
   */
  private mirrorForeignTurn(event: MoxxyEvent): void {
    const text = this.turns.mirrorText(event);
    if (text == null) return;
    const target = this.lastChannel;
    if (!target) return;
    void (async () => {
      for (const part of splitForDiscord(text)) {
        await target.send(part);
      }
    })().catch((err) => {
      this.opts.logger?.warn('discord mirror failed', { err: String(err) });
    });
  }

  private askForPermission(call: PendingToolCall, ctx: PermissionContext): Promise<void> {
    return askForPermission(call, ctx, {
      channel: this.currentChannel,
      session: this.session,
      resolver: this.permissionResolver,
      yolo: this.yolo,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
  }

  private askForApproval(id: string, request: ApprovalRequest): Promise<void> {
    return askForApproval(id, request, {
      channel: this.currentChannel,
      resolver: this.approvalResolver,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
  }
}

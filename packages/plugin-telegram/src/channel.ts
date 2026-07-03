import { Bot, GrammyError, HttpError, InputFile } from 'grammy';
import type { Context } from 'grammy';
import { newTurnId } from '@moxxy/core';
import { TurnCoordinator, deliverVoiceReply, resolveSecret } from '@moxxy/channel-kit';
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
import { TelegramPermissionResolver } from './permission.js';
import { TelegramApprovalResolver } from './approval.js';
import { FramePump } from './channel/frame-pump.js';
import { TypingIndicator } from './channel/typing-indicator.js';
import { PairingHandler } from './channel/pairing-handler.js';
import { askForPermission } from './channel/permission-prompt.js';
import { askForApproval } from './channel/approval-prompt.js';
import { publishBotCommands } from './channel/slash-handler.js';
import {
  handleCallback,
  type AwaitingApprovalText,
} from './channel/callback-handler.js';
import { runUserTurn } from './channel/turn-runner.js';
import { handleTextMessage } from './channel/text-handler.js';
import { handleVoiceMessage } from './channel/voice-handler.js';
import { loadVoiceReplies, saveVoiceReplies } from './keys.js';

const TOKEN_KEY = 'telegram_bot_token';

/** Cap on the up-front `getMe` (bot identity → `t.me` connect link). It must
 *  never gate channel startup: if Telegram is slow/unreachable, we proceed
 *  without the link rather than wedge `start()` (and the readiness it unblocks). */
const BOT_IDENTITY_TIMEOUT_MS = 8_000;

export type { PairingConfirmResult } from './channel/pairing-handler.js';

export interface TelegramStartOpts extends ChannelStartOptsBase {
  readonly session: Session;
  /**
   * If true (and no chat is paired yet), open a host-issued QR pairing window on
   * startup: mint a code, publish a `t.me/<bot>?start=<code>` deep link as the
   * connect value, and pair whichever chat presents that code back (deep-link tap
   * or a plain 6-digit message). Set by the `moxxy channels telegram pair` command
   * (which renders the deep link as a terminal QR and waits via `onPaired`).
   */
  readonly pair?: boolean;
  /**
   * The channel is running on its own dedicated runner under a GUI control
   * surface (the desktop Channels panel) rather than a terminal. Equivalent to
   * `pair` for the unpaired case — `start()` opens the same host-issued QR
   * pairing window instead of throwing — so the desktop pairs with the identical
   * mechanism. Threaded by the CLI from `ChannelDef.dedicatedRunner` /
   * `--dedicated` / `MOXXY_DEDICATED_RUNNER`.
   */
  readonly dedicated?: boolean;
}

export interface TelegramChannelOptions {
  readonly vault: VaultStore;
  readonly token?: string;
  readonly logger?: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
  readonly editFrameMs?: number;
}

export class TelegramChannel implements Channel<TelegramStartOpts> {
  readonly name = 'telegram';
  readonly permissionResolver: TelegramPermissionResolver;
  readonly approvalResolver: TelegramApprovalResolver;
  private readonly opts: TelegramChannelOptions;
  private bot: Bot | null = null;
  // The resolved bot's `t.me/<botname>` link (from getMe at start), published as
  // this channel's `requestUrl` connect value so control surfaces can render a
  // QR / "open the bot" step. While a host-issued pairing window is open it
  // carries the `?start=<code>` deep-link payload. Null until resolved (or if
  // getMe failed).
  private botLink: string | null = null;
  // The host-issued pairing code embedded in `botLink`'s `?start=` payload, set
  // when `start()` opens a host pairing window (dedicated + unpaired). Null
  // otherwise (terminal pairing, or already paired).
  private hostPairingCode: string | null = null;
  // Listeners notified when this channel's connect-state changes (i.e. a chat
  // just paired). The dedicated-runner host subscribes via the handle to
  // re-publish the channel's status file. See `onConnectChange` on the handle.
  private readonly connectListeners = new Set<() => void>();
  private currentChatId: number | null = null;
  // Last chat we ran a turn for — the target for mirroring turns this channel
  // did NOT initiate (e.g. a web-surface action on a shared session).
  private lastChatId: number | null = null;
  private logUnsub: (() => void) | null = null;
  private session: Session | null = null;
  private model: string | undefined;
  private activeModelOverride: string | null = null;
  private yolo = false;
  // When true, the final assistant reply of each turn is also synthesized (via
  // the session's active Synthesizer) and sent as a voice note. Persisted per
  // paired chat in the vault (`telegram_voice_replies`), toggled with `/voice`.
  private voiceReplies = false;
  // Single-flight turn state: `busy` guard, per-turn AbortController (so
  // /cancel aborts only the current turn without poisoning the session-level
  // signal other channels share), and the bounded own-turn-id set that
  // mirrorForeignTurn filters on (invariant #8: filter event-log subscribers
  // by turnId when multiplexing turns on one Session) rather than the coarse
  // `busy` flag alone — so an assistant_message dispatched for our own turn
  // AFTER `busy` flips false (async event ordering / RemoteSession replay)
  // isn't re-mirrored as foreign.
  private readonly turns = new TurnCoordinator();
  // When a user clicks an approval option that needs text follow-up
  // (e.g. plan-execute "Redraft with feedback"), we stash the
  // approval+option pair and capture the user's NEXT message as the
  // follow-up text — same mechanism the TUI uses, just over chat.
  private awaitingApprovalText: AwaitingApprovalText | null = null;
  private handle: ChannelHandle | null = null;
  private readonly framePump: FramePump;
  private readonly typing = new TypingIndicator();
  private readonly pairing: PairingHandler;

  constructor(opts: TelegramChannelOptions) {
    this.opts = opts;
    this.permissionResolver = new TelegramPermissionResolver();
    this.approvalResolver = new TelegramApprovalResolver();
    this.framePump = new FramePump({
      editFrameMs: opts.editFrameMs ?? 1000,
      ...(opts.logger ? { logger: opts.logger } : {}),
    });
    this.pairing = new PairingHandler({
      vault: opts.vault,
      ...(opts.logger ? { logger: opts.logger } : {}),
    });
    // A completed pairing flips this channel's connect-state to "connected";
    // notify the host so it can swap the QR for a "✓ Connected" affordance.
    this.pairing.onPaired(() => this.notifyConnectChange());
  }

  /** This channel's connect value (see {@link Channel.requestUrl}): the resolved
   *  bot's `t.me` link, surfaced by control surfaces as a QR / open-bot step.
   *  While a host pairing window is open it includes the `?start=<code>` payload. */
  get requestUrl(): string | null {
    return this.botLink;
  }

  /** Whether the "connect the other side" step is satisfied — i.e. a chat is
   *  paired (see {@link Channel.connected}). A host shows "✓ Connected" instead
   *  of the pairing QR once this is true. */
  get connected(): boolean {
    return this.pairing.phase() === 'paired';
  }

  private notifyConnectChange(): void {
    for (const listener of this.connectListeners) {
      try {
        listener();
      } catch (err) {
        this.opts.logger?.warn?.('telegram connect-change listener threw', { err: String(err) });
      }
    }
  }

  async start(startOpts: TelegramStartOpts): Promise<ChannelHandle> {
    if (this.handle) return this.handle;
    this.session = startOpts.session;
    this.model = startOpts.model;

    // Precedence mirrors Slack (and this channel's own `isAvailable` gate +
    // error message): an explicit option wins, then the `MOXXY_TELEGRAM_TOKEN`
    // env override, then the vault (the shared env→vault resolution in
    // @moxxy/channel-kit). Without the env fallback a headless
    // `moxxy channels start telegram` that set the env var would pass the
    // availability check but then fail to boot — the gate and the channel must
    // agree on where the token comes from.
    const token =
      this.opts.token ??
      (await resolveSecret(this.opts.vault, {
        envVar: 'MOXXY_TELEGRAM_TOKEN',
        vaultKey: TOKEN_KEY,
      }));
    if (!token) {
      throw new Error(
        `Telegram bot token not found. Store one via vault_set('${TOKEN_KEY}', ...) or set MOXXY_TELEGRAM_TOKEN.`,
      );
    }
    await this.pairing.loadAuthorized();
    this.voiceReplies = await loadVoiceReplies(this.opts.vault);

    // Open the single host-issued QR pairing window when a pairing surface asked
    // for it (`pair`, the terminal `pair` command) OR when running GUI-supervised
    // on a dedicated runner (the desktop) and no chat is paired yet. The code is
    // minted now so we can embed it in the `t.me/<bot>?start=<code>` deep link
    // below; the surface renders that as a QR, and pairing completes when the
    // user taps START (or sends the digits) — no terminal round-trip. Only a
    // headless start with neither signal still errors with a pairing hint.
    const dedicated = startOpts.dedicated === true || process.env.MOXXY_DEDICATED_RUNNER === '1';
    if (this.pairing.phase() !== 'paired') {
      if (startOpts.pair || dedicated) {
        this.hostPairingCode = this.pairing.beginHostWindow();
        this.opts.logger?.info?.('telegram pairing window open');
      } else {
        throw new Error(
          'No Telegram chat is paired yet. Run `moxxy channels telegram pair` to pair, or start it from the desktop Channels panel.',
        );
      }
    }

    this.bot = new Bot(token);
    this.framePump.attachBot(this.bot);
    this.pairing.attachBot(this.bot);
    this.permissionResolver.setDecider((call, ctx) => this.askForPermission(call, ctx));
    this.approvalResolver.setDecider((id, request) => this.askForApproval(id, request));
    // Register the approval resolver on the session so loop strategies
    // (plan-execute) actually surface their plan-validation dialog on
    // this channel. setApprovalResolver(null) on stop tears it down so
    // headless code paths after channel close don't see a stale handler.
    this.session.setApprovalResolver(this.approvalResolver);

    // Mirror-to-both: when the session runs a turn this channel did NOT
    // initiate (e.g. a user submitted a form on the co-attached web surface),
    // post the assistant's prose into the last chat we served. Our OWN turns
    // are rendered by the FramePump (gated by `busy`), so skip those.
    this.logUnsub = this.session.log.subscribe((event) => this.mirrorForeignTurn(event));

    this.bot.command('start', (ctx) => this.pairing.handleStartCommand(ctx));
    this.bot.on('callback_query:data', (ctx) => this.dispatchCallback(ctx));
    // grammy's built-in long-poller (Bot.handleUpdates) awaits each update
    // handler before fetching the next getUpdates batch — so awaiting a
    // whole user turn here would PARK the poll loop for the turn's lifetime.
    // A mid-turn permission prompt waits for a `callback_query` click that
    // grammy could never deliver while parked (deadlock), and `/cancel`
    // would sit undelivered until the turn ends. We dispatch text/voice
    // turns in the background (fire-and-track) so the poll loop stays free
    // to deliver callback_query / permission clicks / `/cancel` mid-turn.
    // Single-flight is preserved because runUserTurn sets `busy` true
    // synchronously and the text/voice handlers reject overlapping turns.
    this.bot.on('message:text', (ctx) => this.dispatchInBackground(this.handleText(ctx), 'text'));
    // Voice notes (press-and-hold) and uploaded audio files. Both go
    // through the same transcribe-then-runUserTurn pipeline; the
    // handler picks the right one off `ctx.message`.
    this.bot.on(['message:voice', 'message:audio'], (ctx) =>
      this.dispatchInBackground(this.handleVoice(ctx, token), 'voice'),
    );
    // Surface the shared registry commands in Telegram's bot-command
    // menu so users see /info, /clear, /new, /exit, /help next to the
    // Telegram-local /model, /loop, /yolo, /tools, /skills, /cancel.
    void publishBotCommands(this.bot, this.session, this.opts.logger);
    this.bot.catch((err) => {
      const e = err.error;
      if (e instanceof GrammyError) this.opts.logger?.warn('grammy error', { description: e.description });
      else if (e instanceof HttpError) this.opts.logger?.warn('http error', { message: e.message });
      else this.opts.logger?.warn('telegram error', { err: String(e) });
    });

    this.opts.logger?.info?.('telegram channel starting', {
      paired: this.pairing.phase() === 'paired',
    });

    // Resolve the bot's own identity up front (getMe) so a control surface can
    // show a `t.me/<botname>` connect step. grammy caches this on `bot.botInfo`,
    // and `bot.start()` below reuses it instead of calling getMe again. Non-fatal
    // AND non-blocking: a transient getMe failure must not block the channel from
    // starting — and neither must a STALLED one. We bound it with a timeout so a
    // slow/unreachable Telegram can't wedge `start()` (which gates bot polling,
    // the web-surface co-attach, and the dedicated runner's status file). On
    // timeout/error we proceed without the link; the poll loop surfaces a
    // genuinely invalid token on its own. (We race a timer rather than pass
    // grammy an AbortSignal — its `init(signal)` types the param against the
    // `abort-controller` polyfill, not the global signal.)
    const bot = this.bot;
    const init = bot.init();
    init.catch(() => undefined); // a late rejection (post-timeout) isn't unhandled
    try {
      await Promise.race([
        init,
        new Promise<never>((_, reject) => {
          const t = setTimeout(
            () => reject(new Error(`getMe timed out after ${BOT_IDENTITY_TIMEOUT_MS}ms`)),
            BOT_IDENTITY_TIMEOUT_MS,
          );
          t.unref?.();
        }),
      ]);
      const username = bot.botInfo.username;
      if (username) {
        // Embed the host-issued code as the `?start=` deep-link payload so a scan
        // → tap-START round-trips `/start <code>` back to us, pairing with zero
        // typing. Plain `t.me/<bot>` once paired (or in terminal-pair mode).
        this.botLink = this.hostPairingCode
          ? `https://t.me/${username}?start=${this.hostPairingCode}`
          : `https://t.me/${username}`;
      }
    } catch (err) {
      this.opts.logger?.warn?.('telegram: could not resolve bot identity (getMe)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const running = bot.start({ drop_pending_updates: false });
    this.handle = {
      running,
      // Let the dedicated-runner host re-publish our status file when a chat
      // pairs (connect-state → connected), so its panel swaps QR for "Connected".
      onConnectChange: (listener) => {
        this.connectListeners.add(listener);
        return () => this.connectListeners.delete(listener);
      },
      stop: async (reason = 'shutdown') => {
        // Abort the in-flight turn FIRST so the model loop stops generating
        // tokens / executing side-effecting tools the moment the operator
        // asks to shut down — otherwise (shared/remote Session) spend and
        // tool calls continue to completion and only their output is discarded.
        this.turns.abort(reason);
        this.permissionResolver.abortAll(reason);
        this.approvalResolver.abortAll(reason);
        this.logUnsub?.();
        this.logUnsub = null;
        if (this.session) this.session.setApprovalResolver(null);
        this.framePump.endTurn();
        this.typing.stop();
        if (this.bot) await this.bot.stop();
      },
    };
    return this.handle;
  }

  pairingPhase(): ReturnType<PairingHandler['phase']> {
    return this.pairing.phase();
  }

  unpair(): void {
    this.pairing.unpair();
  }

  /**
   * Subscribe to "a chat just paired" — fires once when the host-issued QR
   * pairing completes. The `moxxy channels telegram pair` command uses this to
   * print success and stop waiting; returns an unsubscribe function.
   */
  onPaired(listener: (chatId: number) => void): () => void {
    return this.pairing.onPaired(listener);
  }

  private handleVoice(ctx: Context, token: string): Promise<void> {
    return handleVoiceMessage(
      ctx,
      {
        session: this.session,
        busy: this.turns.busy,
      },
      {
        pairing: this.pairing,
        token,
        ...(this.opts.logger ? { logger: this.opts.logger } : {}),
      },
      {
        runUserTurn: (c, chatId, text) => this.runUserTurn(c, chatId, text),
      },
    );
  }

  private handleText(ctx: Context): Promise<void> {
    return handleTextMessage(
      ctx,
      {
        session: this.session,
        model: this.model,
        activeModelOverride: this.activeModelOverride,
        yolo: this.yolo,
        voiceReplies: this.voiceReplies,
        busy: this.turns.busy,
        turnController: this.turns.controller,
        awaitingApprovalText: this.awaitingApprovalText,
        handle: this.handle,
      },
      {
        pairing: this.pairing,
        approvalResolver: this.approvalResolver,
        permissionResolver: this.permissionResolver,
        framePump: this.framePump,
      },
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
        setVoiceReplies: (on) => this.setVoiceReplies(on),
        runUserTurn: (c, chatId, text) => this.runUserTurn(c, chatId, text),
        tryHostPair: (chatId, text) => this.tryHostPair(ctx, chatId, text),
      },
    );
  }

  /** Persist + apply the voice-replies preference (the `/voice` toggle). */
  private async setVoiceReplies(on: boolean): Promise<void> {
    this.voiceReplies = on;
    try {
      await saveVoiceReplies(this.opts.vault, on);
    } catch (err) {
      this.opts.logger?.warn('telegram voice-replies persist failed', { err: String(err) });
    }
  }

  /**
   * Speak the final assistant reply as a voice note, when enabled. Best-effort
   * and fully isolated (never throws): synthesize via the session's active
   * Synthesizer, transcode to OGG/Opus (or send plain audio when ffmpeg is
   * unavailable), and deliver via grammy. The text reply already went out.
   */
  private async sendVoiceReply(chatId: number, text: string): Promise<void> {
    if (!this.voiceReplies || !this.bot || !this.session) return;
    const bot = this.bot;
    const outcome = await deliverVoiceReply(this.session, text, {
      send: async (audio, meta) => {
        const file = new InputFile(audio, meta.filename);
        if (meta.isVoiceNote) await bot.api.sendVoice(chatId, file);
        else await bot.api.sendAudio(chatId, file);
      },
    });
    if (outcome.status === 'failed') {
      this.opts.logger?.warn('telegram voice reply failed', {
        reason: outcome.reason,
        ...(outcome.error ? { err: outcome.error } : {}),
      });
    }
  }

  /**
   * Plain-message fallback for host-issued pairing: if a host window is open and
   * an unauthorized chat sends exactly the 6-digit code, pair it (covers clients
   * that don't auto-deliver the `?start=` deep-link payload). Returns true when
   * the message was a pairing attempt we handled (paired, or a wrong-code reply)
   * so the caller doesn't also emit the generic "not paired" rejection.
   */
  private async tryHostPair(ctx: Context, chatId: number, text: string): Promise<boolean> {
    if (this.pairing.phase() !== 'awaiting-host-code') return false;
    const normalized = text.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalized)) return false;
    const result = await this.pairing.confirmChatCode(chatId, normalized);
    if (result.ok) return true; // confirmChatCode greeted + fired onPaired
    await ctx.reply(result.message);
    return true;
  }

  /**
   * Run a handler promise detached from the grammy poll loop. grammy awaits the
   * value a middleware returns before fetching the next update batch; returning
   * void here (instead of the handler promise) lets the loop keep delivering
   * callback_query / `/cancel` while a turn runs. Errors are logged here because
   * `bot.catch` only sees rejections of the AWAITED middleware chain.
   */
  private dispatchInBackground(work: Promise<void>, kind: string): void {
    void work.catch((err) => {
      this.opts.logger?.warn('telegram handler failed', { kind, err: String(err) });
    });
  }

  private async runUserTurn(ctx: Context, chatId: number, text: string): Promise<void> {
    if (!this.session) throw new Error('TelegramChannel.start() must be called first');
    // Atomic single-flight guard: `begin` claims the slot synchronously BEFORE
    // any await so a second turn dispatched concurrently (the poll loop is no
    // longer parked on us) can't slip past the busy check in the text/voice
    // handlers. If we are already busy, refuse rather than corrupt the
    // single-instance per-turn state (framePump / currentChatId / controller).
    // The turnId is minted here so the coordinator records it as an own-turn
    // id — that's what mirrorForeignTurn filters on.
    const lease = this.turns.begin(newTurnId());
    if (!lease) {
      await ctx.reply('I am still working on the previous prompt. Send /cancel to abort it.');
      return;
    }
    this.currentChatId = chatId;
    this.lastChatId = chatId;
    const effectiveModel = this.activeModelOverride ?? this.model;

    try {
      await runUserTurn(
        ctx,
        {
          session: this.session,
          bot: this.bot,
          framePump: this.framePump,
          typing: this.typing,
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
          onFinalReply: (finalText) => this.sendVoiceReply(chatId, finalText),
        },
        { chatId, text, model: effectiveModel, controller: lease.controller, turnId: lease.turnId },
      );
    } finally {
      lease.end();
      this.currentChatId = null;
    }
  }

  /**
   * Post the assistant's prose for a turn this channel did not initiate. Gated
   * by `!busy` (our own turns are rendered by the FramePump from the runUserTurn
   * iterator) and by having served a chat at least once. Sent as plain text to
   * avoid parse-mode pitfalls; the view itself lives on the web surface.
   */
  private mirrorForeignTurn(event: MoxxyEvent): void {
    // The coordinator skips turns THIS channel initiated, by turnId — robust to
    // events that arrive after `busy` flips false (async ordering /
    // RemoteSession replay), which the `busy` flag alone could mis-mirror as
    // foreign (invariant #8) — and yields the trimmed assistant prose.
    const text = this.turns.mirrorText(event);
    if (text == null) return;
    if (!this.bot || this.lastChatId == null) return;
    void this.bot.api.sendMessage(this.lastChatId, text).catch((err) => {
      this.opts.logger?.warn('telegram mirror failed', { err: String(err) });
    });
  }

  private askForPermission(call: PendingToolCall, ctx: PermissionContext): Promise<void> {
    return askForPermission(call, ctx, {
      bot: this.bot,
      chatId: this.currentChatId,
      session: this.session,
      resolver: this.permissionResolver,
      yolo: this.yolo,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
  }

  private askForApproval(id: string, request: ApprovalRequest): Promise<void> {
    return askForApproval(id, request, {
      bot: this.bot,
      chatId: this.currentChatId,
      resolver: this.approvalResolver,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
  }

  private dispatchCallback(ctx: Context): Promise<void> {
    return handleCallback(
      ctx,
      {
        bot: this.bot,
        session: this.session,
        chatId: this.currentChatId,
        permissionResolver: this.permissionResolver,
        approvalResolver: this.approvalResolver,
        pairing: this.pairing,
      },
      {
        setAwaitingApprovalText: (state) => {
          this.awaitingApprovalText = state;
        },
        setActiveModelOverride: (modelId) => {
          this.activeModelOverride = modelId;
        },
      },
    );
  }
}

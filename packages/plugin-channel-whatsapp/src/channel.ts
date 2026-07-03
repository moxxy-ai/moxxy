import { newTurnId } from '@moxxy/core';
import { TurnCoordinator } from '@moxxy/channel-kit';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { Channel, ChannelHandle, ChannelStartOptsBase, MoxxyEvent } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  createFileAuthStorage,
  hasStoredCreds,
  type WhatsAppAuthStorage,
} from './auth-state.js';
import { CONSENT_REQUIRED_MESSAGE, hasConsent } from './consent.js';
import {
  WHATSAPP_ALLOWED_JIDS_KEY,
  WHATSAPP_AUTH_DIR,
  WHATSAPP_OWNER_JID_KEY,
  normalizeJid,
  parseAllowedJids,
} from './keys.js';
import { gateInboundMessage, type GateVerdict } from './message-gate.js';
import {
  createWhatsAppPermissionController,
  type WhatsAppPermissionController,
} from './permission.js';
import { openBaileysSocket } from './baileys-socket.js';
import {
  WA_DISCONNECT,
  disconnectStatusCode,
  type WaConnectionUpdate,
  type WaInboundMessage,
  type WaMessageKey,
  type WhatsAppSocket,
  type WhatsAppSocketFactory,
} from './socket.js';
import { DEFAULT_EDIT_FRAME_MS, runWhatsAppTurn } from './channel/turn-runner.js';
import { transcribeVoiceMessage } from './channel/voice-handler.js';

/** Bound on remembered own-send message ids (echo/loop protection). */
const MAX_SENT_IDS = 512;

export interface WhatsAppChannelLogger {
  debug?(msg: string, meta?: Record<string, unknown>): void;
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface WhatsAppChannelOptions {
  readonly vault: VaultStore;
  readonly logger?: WhatsAppChannelLogger;
  /** Debounce window for streaming edits (ms). Default 3000 — deliberately
   *  slower than Telegram/Slack; see the turn-runner rationale. */
  readonly editFrameMs?: number;
  /** Injectable transport (tests). Defaults to the real Baileys socket. */
  readonly socketFactory?: WhatsAppSocketFactory;
  /** Injectable auth-state backend. Defaults to `~/.moxxy/whatsapp-auth`. */
  readonly authStorage?: WhatsAppAuthStorage;
  /** Extra allow-listed JIDs from channel config/flags. */
  readonly allowedJids?: ReadonlyArray<string>;
  /** Consecutive reconnect attempts before giving up. Default 5. */
  readonly maxReconnectAttempts?: number;
  /** Reconnect backoff base (ms). Default 2000; tests shrink it. */
  readonly reconnectBaseMs?: number;
}

export interface WhatsAppStartOpts extends ChannelStartOptsBase {
  readonly session: Session;
  /** Open in pairing mode: an unlinked start publishes QR payloads instead of
   *  refusing. Set by `moxxy channels whatsapp pair` / the setup wizard. */
  readonly pair?: boolean;
  /** Running GUI-supervised on a dedicated runner (desktop Channels panel) —
   *  equivalent to `pair` for the unlinked case, so the desktop can render the
   *  QR from the status file instead of a terminal. */
  readonly dedicated?: boolean;
}

export class WhatsAppChannel implements Channel<WhatsAppStartOpts> {
  readonly name = 'whatsapp';
  private readonly permission: WhatsAppPermissionController;
  private readonly opts: WhatsAppChannelOptions;
  private readonly turns = new TurnCoordinator();

  private session: Session | null = null;
  private model: string | undefined;
  private socket: WhatsAppSocket | null = null;
  private storage: WhatsAppAuthStorage | null = null;
  private handle: ChannelHandle | null = null;
  private logUnsub: (() => void) | null = null;

  private stopping = false;
  private resolveRunning: (() => void) | null = null;
  private rejectRunning: ((err: Error) => void) | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private pairMode = false;
  private pairedAnnounced = false;
  private qrPayload: string | null = null;
  private socketOpen = false;
  private ownerJid: string | null = null;
  private readonly allowSet = new Set<string>();

  private currentJid: string | null = null;
  private lastJid: string | null = null;

  /** Recent OWN outbound message ids — Baileys echoes our sends back via
   *  `messages.upsert`; without this the bot would converse with itself. */
  private readonly sentIds = new Set<string>();

  private readonly connectListeners = new Set<() => void>();
  private readonly pairedListeners = new Set<(ownerJid: string) => void>();

  constructor(opts: WhatsAppChannelOptions) {
    this.opts = opts;
    this.permission = createWhatsAppPermissionController();
  }

  get permissionResolver(): WhatsAppPermissionController['resolver'] {
    return this.permission.resolver;
  }

  /** Connect value published to control surfaces (`connect.kind: 'qr'`): the
   *  CURRENT Baileys QR pairing payload while unlinked (it rotates; each
   *  rotation re-publishes via onConnectChange), null once linked. */
  get requestUrl(): string | null {
    return this.qrPayload;
  }

  /** Linked + socket open — control surfaces swap the QR for "Connected". */
  get connected(): boolean {
    return this.socketOpen && this.ownerJid != null;
  }

  /** Fires once when a fresh QR link completes (the pair flow waits on this). */
  onPaired(listener: (ownerJid: string) => void): () => void {
    this.pairedListeners.add(listener);
    return () => this.pairedListeners.delete(listener);
  }

  async start(startOpts: WhatsAppStartOpts): Promise<ChannelHandle> {
    if (this.handle) return this.handle;

    // CONSENT GATE — defense in depth: the wizard/pair/subcommand paths check
    // too, but start() is reachable headlessly (`moxxy whatsapp` with vault
    // state, desktop supervisor), so the channel itself refuses un-acknowledged.
    if (!(await hasConsent(this.opts.vault))) {
      throw new Error(CONSENT_REQUIRED_MESSAGE);
    }

    this.session = startOpts.session;
    this.model = startOpts.model;
    this.storage =
      this.opts.authStorage ?? createFileAuthStorage(moxxyPath(WHATSAPP_AUTH_DIR));

    const dedicated =
      startOpts.dedicated === true || process.env.MOXXY_DEDICATED_RUNNER === '1';
    this.pairMode = startOpts.pair === true || dedicated;

    const hadCreds = await hasStoredCreds(this.storage);
    if (!hadCreds && !this.pairMode) {
      throw new Error(
        'No WhatsApp account is linked yet. Run `moxxy channels whatsapp pair` to scan ' +
          'the QR, or start it from the desktop Channels panel.',
      );
    }
    this.pairedAnnounced = hadCreds;

    // Allow-list: the owner's own JID (Note to Self) is seeded on link; extra
    // JIDs come from the vault and channel options. Persisted owner JID lets
    // the gate work from the first inbound even before `open` resolves it.
    this.ownerJid = normalizeJid(await this.opts.vault.get(WHATSAPP_OWNER_JID_KEY));
    this.rebuildAllowList(
      parseAllowedJids(await this.opts.vault.get(WHATSAPP_ALLOWED_JIDS_KEY)),
    );

    this.permission.setSender((text) => this.sendPermissionPrompt(text));

    // Mirror-to-chat: post assistant prose for turns this channel did NOT
    // initiate (co-attached surface) into the last chat served (invariant #8:
    // own turns are filtered by turnId inside TurnCoordinator.mirrorText).
    this.logUnsub = this.session.log.subscribe((event) => this.mirrorForeignTurn(event));

    const running = new Promise<void>((resolve, reject) => {
      this.resolveRunning = resolve;
      this.rejectRunning = reject;
    });

    await this.connect();

    this.opts.logger?.info?.('whatsapp channel starting', {
      linked: hadCreds,
      pairMode: this.pairMode,
    });

    this.handle = {
      running,
      onConnectChange: (listener) => {
        this.connectListeners.add(listener);
        return () => this.connectListeners.delete(listener);
      },
      stop: async (reason = 'shutdown') => {
        this.teardown(reason);
        this.resolveRunning?.();
        this.resolveRunning = null;
        this.rejectRunning = null;
      },
    };
    return this.handle;
  }

  // ---- connection lifecycle -------------------------------------------------

  private async connect(): Promise<void> {
    if (this.stopping || !this.storage) return;
    const factory = this.opts.socketFactory ?? openBaileysSocket;
    const socket = await factory({
      storage: this.storage,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
    this.socket = socket;
    socket.onConnectionUpdate((update) => this.handleConnectionUpdate(update));
    socket.onMessages((upsert) => {
      for (const message of upsert.messages) {
        this.dispatchInBackground(this.handleInbound(upsert.type, message), 'message');
      }
    });
  }

  private handleConnectionUpdate(update: WaConnectionUpdate): void {
    if (update.qr) {
      this.qrPayload = update.qr;
      this.notifyConnectChange();
    }
    if (update.connection === 'open') {
      this.reconnectAttempts = 0;
      this.socketOpen = true;
      this.qrPayload = null;
      const owner = normalizeJid(this.socket?.userJid() ?? null);
      if (owner) {
        this.ownerJid = owner;
        this.allowSet.add(owner);
        void this.opts.vault
          .set(WHATSAPP_OWNER_JID_KEY, owner, ['whatsapp'])
          .catch((err: unknown) => {
            this.opts.logger?.warn?.('whatsapp: could not persist owner jid', {
              err: String(err),
            });
          });
        if (!this.pairedAnnounced) {
          this.pairedAnnounced = true;
          this.emitPaired(owner);
          void this.send(
            owner,
            'Linked with moxxy. Message yourself in this chat (Note to Self) to talk to ' +
              'the agent. Commands: /cancel aborts the current turn, /new resets the session.',
          );
        }
      }
      this.notifyConnectChange();
      return;
    }
    if (update.connection === 'close') {
      this.socketOpen = false;
      this.notifyConnectChange();
      if (this.stopping) return;
      this.handleClose(disconnectStatusCode(update.lastDisconnect?.error));
    }
  }

  private handleClose(code: number | null): void {
    if (code === WA_DISCONNECT.loggedOut) {
      // The phone unlinked this device — the stored creds are dead. Clear them
      // (standard Baileys practice) and either re-open a QR pairing window
      // (pair/dedicated mode) or stop with re-pair guidance.
      this.opts.logger?.warn?.('whatsapp: logged out by the phone — clearing local credentials');
      this.pairedAnnounced = false;
      void this.storage
        ?.clear()
        .catch(() => undefined)
        .then(() => this.opts.vault.delete(WHATSAPP_OWNER_JID_KEY).catch(() => undefined))
        .then(() => {
          if (this.pairMode) this.scheduleReconnect(0);
          else {
            this.fail(
              'WhatsApp logged this device out. Run `moxxy channels whatsapp pair` to re-link ' +
                '(check `moxxy channels whatsapp status`).',
            );
          }
        });
      return;
    }
    if (code === WA_DISCONNECT.connectionReplaced) {
      this.fail(
        'Another WhatsApp Web session replaced this one (440). Stop the other client, then restart the channel.',
      );
      return;
    }
    if (code === WA_DISCONNECT.forbidden) {
      this.fail(
        'WhatsApp refused the connection (403). The number may have been blocked or banned — ' +
          'this is the documented risk of the unofficial API.',
      );
      return;
    }
    // restartRequired (515) is the NORMAL post-QR-scan handoff: reconnect
    // immediately. Everything else retries with exponential backoff.
    if (code === WA_DISCONNECT.restartRequired) {
      this.scheduleReconnect(0);
      return;
    }
    this.reconnectAttempts += 1;
    const max = this.opts.maxReconnectAttempts ?? 5;
    if (this.reconnectAttempts > max) {
      this.fail(`whatsapp: giving up after ${max} consecutive reconnect attempts (last code: ${code ?? 'unknown'})`);
      return;
    }
    const base = this.opts.reconnectBaseMs ?? 2000;
    this.scheduleReconnect(base * 2 ** (this.reconnectAttempts - 1));
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.stopping) return;
    this.socket = null;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((err: unknown) => {
        this.fail(
          `whatsapp: reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private fail(message: string): void {
    if (this.stopping) return;
    this.opts.logger?.warn?.(message);
    this.teardown(message);
    this.rejectRunning?.(new Error(message));
    this.resolveRunning = null;
    this.rejectRunning = null;
  }

  private teardown(reason: string): void {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Abort the in-flight turn FIRST so the model loop stops spending the
    // moment the operator asks to shut down; then deny pending permission
    // prompts so no caller hangs (the audit's TuiChannel.stop lesson).
    this.turns.abort(reason);
    this.permission.abortAll(reason);
    this.permission.setSender(null);
    this.logUnsub?.();
    this.logUnsub = null;
    this.qrPayload = null;
    this.socketOpen = false;
    this.socket?.end();
    this.socket = null;
  }

  // ---- inbound --------------------------------------------------------------

  private async handleInbound(upsertType: string, raw: WaInboundMessage): Promise<void> {
    const verdict: GateVerdict = gateInboundMessage(
      {
        ownJid: this.ownerJid,
        allowedJids: this.allowSet,
        isOwnSend: (id) => this.sentIds.has(id),
      },
      upsertType,
      raw,
    );
    if (!verdict.ok) {
      // Silent drop (no reply): replying to unauthorized senders would leak
      // the bot's existence and look like spam — both ban vectors.
      this.opts.logger?.debug?.('whatsapp: dropped inbound', { reason: verdict.reason });
      return;
    }

    if (verdict.kind === 'text') {
      await this.handleText(verdict.jid, verdict.text);
      return;
    }
    await this.handleAudio(verdict.jid, verdict.mimeType, raw);
  }

  private async handleText(jid: string, text: string): Promise<void> {
    // A pending permission prompt captures the next short reply — BEFORE the
    // busy guard, because prompts happen mid-turn by construction.
    if (this.permission.hasPending() && this.permission.offerReply(text)) return;

    if (text === '/cancel') {
      const controller = this.turns.controller;
      if (controller && !controller.signal.aborted) {
        controller.abort('user cancel');
        await this.send(jid, 'cancelling current turn…');
      } else {
        await this.send(jid, 'nothing to cancel.');
      }
      return;
    }
    if (text === '/new') {
      await this.resetSession(jid);
      return;
    }
    if (this.turns.busy) {
      await this.send(jid, 'I am still working on the previous prompt. Send /cancel to abort it.');
      return;
    }
    await this.runUserTurn(jid, text);
  }

  private async handleAudio(
    jid: string,
    mimeType: string,
    raw: WaInboundMessage,
  ): Promise<void> {
    if (!this.session || !this.socket) return;
    if (this.turns.busy) {
      await this.send(jid, 'I am still working on the previous prompt. Send /cancel to abort it.');
      return;
    }
    const transcript = await transcribeVoiceMessage(
      {
        session: this.session,
        socket: this.socket,
        reply: (j, t) => this.send(j, t),
        ...(this.opts.logger ? { logger: this.opts.logger } : {}),
      },
      { jid, mimeType, raw },
    );
    if (transcript) await this.runUserTurn(jid, transcript);
  }

  private async resetSession(jid: string): Promise<void> {
    if (!this.session) return;
    const controller = this.turns.controller;
    if (controller && !controller.signal.aborted) controller.abort('user reset');
    this.permission.abortAll('session reset');
    // Wipe history at its source; a mirror-only clear would desync (A10).
    try {
      if (typeof this.session.reset === 'function') await this.session.reset();
      else this.session.log.clear();
    } catch (err) {
      await this.send(
        jid,
        `/new failed: ${err instanceof Error ? err.message : String(err)} — history NOT cleared`,
      );
      return;
    }
    await this.send(jid, 'new session — conversation history cleared');
  }

  private async runUserTurn(jid: string, text: string): Promise<void> {
    if (!this.session || !this.socket) return;
    // Atomic single-flight: `begin` claims the slot synchronously so two
    // concurrently dispatched messages can't interleave per-turn state. The
    // turnId is minted here so the coordinator records it as an own-turn id
    // (mirrorForeignTurn filters on those, invariant #8).
    const lease = this.turns.begin(newTurnId());
    if (!lease) {
      await this.send(jid, 'I am still working on the previous prompt. Send /cancel to abort it.');
      return;
    }
    this.currentJid = jid;
    this.lastJid = jid;
    try {
      await runWhatsAppTurn(
        {
          session: this.session,
          socket: this.socket,
          editFrameMs: this.opts.editFrameMs ?? DEFAULT_EDIT_FRAME_MS,
          recordSentId: (key) => this.recordSentId(key),
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
        },
        {
          jid,
          text,
          model: this.model,
          controller: lease.controller,
          turnId: lease.turnId,
        },
      );
    } finally {
      lease.end();
      this.currentJid = null;
    }
  }

  // ---- outbound -------------------------------------------------------------

  /** Every outbound send goes through here so its id lands in the echo set. */
  private async send(jid: string, text: string): Promise<void> {
    if (!this.socket) return;
    try {
      const sent = await this.socket.sendText(jid, text);
      this.recordSentId(sent?.key);
    } catch (err) {
      this.opts.logger?.warn?.('whatsapp send failed', { err: String(err) });
    }
  }

  private sendPermissionPrompt(text: string): Promise<void> {
    const target = this.currentJid ?? this.lastJid ?? this.ownerJid;
    if (!target) return Promise.reject(new Error('no chat to prompt in'));
    return this.send(target, text);
  }

  private recordSentId(key: WaMessageKey | null | undefined): void {
    const id = key?.id;
    if (!id) return;
    this.sentIds.add(id);
    if (this.sentIds.size > MAX_SENT_IDS) {
      const oldest = this.sentIds.values().next().value;
      if (oldest !== undefined) this.sentIds.delete(oldest);
    }
  }

  private mirrorForeignTurn(event: MoxxyEvent): void {
    const text = this.turns.mirrorText(event);
    if (text == null) return;
    const target = this.lastJid ?? this.ownerJid;
    if (!target) return;
    void this.send(target, text);
  }

  // ---- listeners ------------------------------------------------------------

  private notifyConnectChange(): void {
    for (const listener of this.connectListeners) {
      try {
        listener();
      } catch (err) {
        this.opts.logger?.warn?.('whatsapp connect-change listener threw', { err: String(err) });
      }
    }
  }

  private emitPaired(ownerJid: string): void {
    for (const listener of this.pairedListeners) {
      try {
        listener(ownerJid);
      } catch (err) {
        this.opts.logger?.warn?.('whatsapp paired listener threw', { err: String(err) });
      }
    }
  }

  private rebuildAllowList(extra: ReadonlyArray<string>): void {
    this.allowSet.clear();
    if (this.ownerJid) this.allowSet.add(this.ownerJid);
    for (const jid of this.opts.allowedJids ?? []) {
      const normalized = normalizeJid(jid);
      if (normalized) this.allowSet.add(normalized);
    }
    for (const jid of extra) this.allowSet.add(jid);
  }

  /**
   * Run a handler detached from the socket's event dispatch (a whole user turn
   * must not block Baileys' event loop). Errors are logged here — nothing above
   * awaits the promise.
   */
  private dispatchInBackground(work: Promise<void>, kind: string): void {
    void work.catch((err: unknown) => {
      this.opts.logger?.warn?.('whatsapp handler failed', { kind, err: String(err) });
    });
  }
}

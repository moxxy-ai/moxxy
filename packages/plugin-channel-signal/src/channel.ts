import { newTurnId } from '@moxxy/core';
import { TurnCoordinator, resolveSecret } from '@moxxy/channel-kit';
import { assertDefined, type ClientSession as Session } from '@moxxy/sdk';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  MoxxyEvent,
  PermissionResolver,
} from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  SIGNAL_ACCOUNT_ENV,
  SIGNAL_ACCOUNT_KEY,
  SIGNAL_ALLOWED_SENDERS_KEY,
  normalizeSender,
  parseAllowedSenders,
} from './keys.js';
import {
  receiveParamsSchema,
  type SignalAttachment,
  type SignalEnvelope,
} from './schema.js';
import {
  SIGNAL_CLI_INSTALL_HINT,
  SignalSidecar,
  findSignalCliOnPath,
  listSignalAccounts,
  signalCliAttachmentsDir,
  startLinkProcess,
  type LinkProcessHandle,
  type SpawnFn,
} from './sidecar.js';
import { buildSignalPermissionResolver } from './permission.js';
import { runSignalTurn } from './channel/turn-runner.js';
import { splitForSignal } from './channel/chunker.js';
import { pickAudioAttachment, transcribeVoiceAttachment } from './channel/voice.js';

/** Device name shown in the phone's "Linked Devices" list. */
const LINK_DEVICE_NAME = 'moxxy';

/** Bound on remembered own-send timestamps for the sync-echo drop. */
const MAX_SENT_TIMESTAMPS = 256;

/** Rate limit for "dropped invalid/unauthorized envelope" warnings. */
const DROP_WARN_INTERVAL_MS = 5_000;

export interface SignalChannelLogger {
  debug?(msg: string, meta?: Record<string, unknown>): void;
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

/** Where a reply goes: the owner's Note-to-Self thread, or a direct recipient. */
export type SendTarget = { readonly noteToSelf: true } | { readonly recipient: string };

/** The RPC slice the channel drives (SignalRpcClient satisfies it; tests fake it). */
export interface SignalRpcLike {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onNotification(method: string, listener: (params: unknown) => void): () => void;
  onClose(listener: (reason: string) => void): () => void;
  close(): void;
}

/** The sidecar slice the channel manages (SignalSidecar satisfies it). */
export interface SignalSidecarLike {
  start(): Promise<SignalRpcLike>;
  stop(): Promise<void>;
  onExit(listener: (code: number | null) => void): () => void;
}

export interface SignalStartOpts extends ChannelStartOptsBase {
  readonly session: Session;
  /**
   * If true (and the account isn't linked yet), open a linking window on
   * startup: spawn `signal-cli link`, publish the `sgnl://linkdevice…` URI as
   * this channel's connect value (rendered as a QR by the pair flow / desktop
   * Channels panel), and boot the daemon once the phone completes the link.
   */
  readonly pair?: boolean;
  /**
   * Running on a dedicated runner under a GUI control surface (the desktop
   * Channels panel). Equivalent to `pair` for the unlinked case, so the desktop
   * links with the identical mechanism instead of getting a throw.
   */
  readonly dedicated?: boolean;
  /** Override the autonomous tool allow-list at start. */
  readonly allowedTools?: ReadonlyArray<string>;
}

export interface SignalChannelOptions {
  readonly vault: VaultStore;
  /** Account override (E.164); beats env + vault. */
  readonly account?: string;
  /** signal-cli binary path/name override. Default: resolve from PATH. */
  readonly binary?: string;
  /** Tools the model may call autonomously. `['*']` allows every registered tool. */
  readonly allowedTools?: ReadonlyArray<string>;
  /** Extra allowed senders (E.164/uuid), merged with the vault allow-list. */
  readonly allowedSenders?: ReadonlyArray<string>;
  readonly logger?: SignalChannelLogger;
  // --- test seams (production uses the real signal-cli) ---
  readonly sidecarFactory?: (opts: { account: string; binary: string }) => SignalSidecarLike;
  readonly linkFactory?: (opts: { deviceName: string; binary: string }) => LinkProcessHandle;
  readonly listAccountsFn?: (opts: { binary: string }) => Promise<string[]>;
  readonly findBinaryFn?: () => string | null;
  readonly attachmentsDir?: string;
  readonly spawnFn?: SpawnFn;
}

export class SignalChannel implements Channel<SignalStartOpts> {
  readonly name = 'signal';
  /**
   * Installed on the session by the CLI dispatcher. Replaced in `start()` once
   * the live tool registry is available for `['*']` expansion; until then it
   * denies everything (safe default before start).
   */
  permissionResolver: PermissionResolver;

  private readonly opts: SignalChannelOptions;
  private session: Session | null = null;
  private model: string | undefined;
  private account: string | null = null;
  private allowedSenders = new Set<string>();

  private sidecar: SignalSidecarLike | null = null;
  private rpc: SignalRpcLike | null = null;
  private link: LinkProcessHandle | null = null;

  private handle: ChannelHandle | null = null;
  private runningSettled = false;
  private resolveRunning: (() => void) | null = null;
  private rejectRunning: ((err: Error) => void) | null = null;
  private stopping = false;

  // Single-flight turn state + the bounded own-turn-id set the foreign-turn
  // mirror gate filters on (invariant #8).
  private readonly turns = new TurnCoordinator();
  private lastTarget: SendTarget | null = null;
  private logUnsub: (() => void) | null = null;

  /**
   * Timestamps of messages WE sent through the daemon (signal-cli's `send`
   * result). A linked device sees the account's sends come back as
   * `syncMessage.sentMessage` envelopes — including its own — so any sync'd
   * sent-message whose timestamp is in this set is an echo of ourselves and
   * must be dropped (loop protection).
   */
  private readonly sentTimestamps = new Set<number>();

  // Link-window connect state, published via requestUrl/connected + the
  // dedicated-runner status file (the desktop panel renders the QR from it).
  private linkUri: string | null = null;
  private linked = false;
  private readonly connectListeners = new Set<() => void>();
  private readonly linkedListeners = new Set<(account: string) => void>();

  private lastDropWarnAt = 0;

  constructor(opts: SignalChannelOptions) {
    this.opts = opts;
    // Pre-start: deny-all (replaced with the real allow-list resolver in start()).
    this.permissionResolver = buildSignalPermissionResolver({
      allowedTools: [],
      allToolNames: [],
      ...(opts.logger ? { logger: opts.logger } : {}),
    });
  }

  /** The `sgnl://linkdevice…` URI while a linking window is open; null otherwise. */
  get requestUrl(): string | null {
    return this.linkUri;
  }

  /** Whether the account is linked (the "connect the other side" step). */
  get connected(): boolean {
    return this.linked;
  }

  /** Fires when linking completes (the pair flow prints success off this). */
  onLinked(listener: (account: string) => void): () => void {
    this.linkedListeners.add(listener);
    return () => this.linkedListeners.delete(listener);
  }

  async start(startOpts: SignalStartOpts): Promise<ChannelHandle> {
    if (this.handle) return this.handle;
    this.session = startOpts.session;
    this.model = startOpts.model;

    const findBinary = this.opts.findBinaryFn ?? (() => findSignalCliOnPath());
    const binary = this.opts.binary ?? findBinary();
    if (!binary) throw new Error(SIGNAL_CLI_INSTALL_HINT);

    // Account: explicit option → env → vault (shared channel-kit precedence).
    this.account =
      this.opts.account ??
      (await resolveSecret(this.opts.vault, {
        envVar: SIGNAL_ACCOUNT_ENV,
        vaultKey: SIGNAL_ACCOUNT_KEY,
      }));

    // Sender allow-list: vault + option extras. The owner's own Note-to-Self is
    // allowed implicitly (see handleSyncSent) and needs no entry.
    this.allowedSenders = new Set(
      [
        ...parseAllowedSenders(await this.opts.vault.get(SIGNAL_ALLOWED_SENDERS_KEY)),
        ...(this.opts.allowedSenders ?? []).map(normalizeSender),
      ].filter(Boolean),
    );

    // Linked yet? (One-shot `listAccounts` spawn — NOT in isAvailable, JVM
    // spawns are too slow for discovery.) A probe failure is treated as
    // "assume linked" when an account is configured: the daemon boot below
    // surfaces the real error with signal-cli's own stderr, which beats
    // guessing wrong and opening a spurious link window.
    let isLinked = false;
    if (this.account) {
      try {
        const listAccounts = this.opts.listAccountsFn ?? ((o: { binary: string }) => listSignalAccounts(o));
        const accounts = await listAccounts({ binary });
        isLinked = accounts.includes(this.account);
      } catch (err) {
        this.opts.logger?.warn?.('signal: listAccounts probe failed; assuming linked', {
          err: err instanceof Error ? err.message : String(err),
        });
        isLinked = true;
      }
    }

    // Swap in the real autonomous allow-list resolver now that the tool
    // registry is live (mirrors the Slack channel; `['*']` expands here).
    const allowedTools = startOpts.allowedTools ?? this.opts.allowedTools ?? [];
    const allToolNames = this.session.tools.list().map((t) => t.name);
    this.permissionResolver = buildSignalPermissionResolver({
      allowedTools,
      allToolNames,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
    this.session.setPermissionResolver(this.permissionResolver);

    // Mirror-to-last-target: post assistant prose for turns this channel did
    // NOT initiate (a co-attached surface ran one) into the last thread served.
    this.logUnsub = this.session.log.subscribe((event) => this.mirrorForeignTurn(event));

    const running = new Promise<void>((resolve, reject) => {
      this.resolveRunning = resolve;
      this.rejectRunning = reject;
    });

    const dedicated = startOpts.dedicated === true || process.env.MOXXY_DEDICATED_RUNNER === '1';
    if (isLinked) {
      this.linked = true;
      assertDefined(this.account, 'isLinked is only reached when this.account is set');
      await this.bootDaemon(binary, this.account);
    } else if (startOpts.pair || dedicated) {
      await this.openLinkWindow(binary);
    } else {
      this.logUnsub?.();
      this.logUnsub = null;
      throw new Error(
        'This machine is not linked to a Signal account yet. Run `moxxy channels signal pair` ' +
          '(scan the QR with your phone: Signal → Settings → Linked Devices), or start it from the desktop Channels panel.',
      );
    }

    this.handle = {
      running,
      onConnectChange: (listener) => {
        this.connectListeners.add(listener);
        return () => this.connectListeners.delete(listener);
      },
      stop: async (reason = 'shutdown') => {
        this.stopping = true;
        // Abort the in-flight turn FIRST so the model loop stops the moment the
        // operator asks to shut down (shared/remote Session: spend continues
        // otherwise and only its output is discarded).
        this.turns.abort(reason);
        this.link?.cancel();
        this.link = null;
        this.logUnsub?.();
        this.logUnsub = null;
        const sidecar = this.sidecar;
        this.sidecar = null;
        this.rpc = null;
        if (sidecar) await sidecar.stop();
        this.settleRunning();
      },
    };
    this.opts.logger?.info?.('signal: channel started', {
      linked: this.linked,
      account: this.account,
      allowedSenders: this.allowedSenders.size,
    });
    return this.handle;
  }

  // -------------------------------------------------------------------------
  // Linking (secondary-device pairing)
  // -------------------------------------------------------------------------

  private async openLinkWindow(binary: string): Promise<void> {
    const makeLink =
      this.opts.linkFactory ??
      ((o: { deviceName: string; binary: string }) =>
        startLinkProcess({
          deviceName: o.deviceName,
          binary: o.binary,
          ...(this.opts.spawnFn ? { spawnFn: this.opts.spawnFn } : {}),
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
        }));
    const link = makeLink({ deviceName: LINK_DEVICE_NAME, binary });
    this.link = link;
    this.linkUri = await link.uri; // throws when signal-cli can't start linking
    this.notifyConnectChange();
    this.opts.logger?.info?.('signal: linking window open');

    // Completion is async (the user scans on their phone). Boot the daemon the
    // moment linking lands; a failure at any point is fatal for the handle so
    // a supervisor restarts us (and the pair flow surfaces the error).
    void link.completed
      .then(async ({ account }) => {
        if (this.stopping) return;
        const acct = account ?? this.account;
        if (!acct) {
          throw new Error(
            'linking completed but signal-cli did not report the account number — ' +
              `store it via \`moxxy channels signal setup\` (vault key ${SIGNAL_ACCOUNT_KEY}) and restart`,
          );
        }
        this.account = acct;
        await this.opts.vault.set(SIGNAL_ACCOUNT_KEY, acct, ['signal']);
        this.link = null;
        this.linkUri = null;
        this.linked = true;
        await this.bootDaemon(binary, acct);
        this.notifyConnectChange();
        for (const listener of this.linkedListeners) {
          try {
            listener(acct);
          } catch {
            /* listener errors are not ours */
          }
        }
        this.opts.logger?.info?.('signal: linked', { account: acct });
      })
      .catch((err: unknown) => {
        if (this.stopping) return;
        this.fatal(
          new Error(`Signal linking failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      });
  }

  // -------------------------------------------------------------------------
  // Daemon + inbound envelopes
  // -------------------------------------------------------------------------

  private async bootDaemon(binary: string, account: string): Promise<void> {
    const makeSidecar =
      this.opts.sidecarFactory ??
      ((o: { account: string; binary: string }) =>
        new SignalSidecar({
          account: o.account,
          binary: o.binary,
          ...(this.opts.spawnFn ? { spawnFn: this.opts.spawnFn } : {}),
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
        }));
    const sidecar = makeSidecar({ account, binary });
    this.sidecar = sidecar;
    const rpc = await sidecar.start();
    this.rpc = rpc;
    rpc.onNotification('receive', (params) => this.handleReceive(params));
    // An unexpected daemon death is fatal: reject `running` so the process
    // exits non-zero and a supervisor (desktop panel / systemd) restarts it.
    sidecar.onExit((code) => {
      if (this.stopping) return;
      this.fatal(new Error(`signal-cli daemon exited unexpectedly (code=${code ?? 'null'})`));
    });
  }

  /** Every inbound notification funnels through here — zod-validate FIRST. */
  private handleReceive(params: unknown): void {
    const parsed = receiveParamsSchema.safeParse(params);
    if (!parsed.success) {
      this.warnDrop('invalid receive payload (schema mismatch)');
      return;
    }
    const envelope = parsed.data.envelope;
    if (envelope.dataMessage) {
      this.handleDataMessage(envelope);
      return;
    }
    const sent = envelope.syncMessage?.sentMessage;
    if (sent) {
      this.handleSyncSent(sent);
      return;
    }
    // Typing / receipt / group-update envelopes: nothing to do.
  }

  /** A message from ANOTHER account — gate on the sender allow-list. */
  private handleDataMessage(envelope: SignalEnvelope): void {
    const data = envelope.dataMessage;
    assertDefined(data, 'handleDataMessage is only called when envelope.dataMessage is present');
    const number = envelope.sourceNumber ?? null;
    const uuid = envelope.sourceUuid ?? null;
    const senderIds = [number, uuid, envelope.source ?? null]
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .map(normalizeSender);
    if (senderIds.length === 0) {
      this.warnDrop('data message without a sender identity');
      return;
    }
    // v1: direct messages only. Group fan-in needs its own trust story.
    if (data.groupInfo) {
      this.opts.logger?.debug?.('signal: ignoring group message');
      return;
    }
    // Our own account as a dataMessage source is an echo path (legit owner
    // prompts arrive as syncMessage.sentMessage) — never respond to ourselves.
    if (this.account && senderIds.includes(normalizeSender(this.account))) {
      this.opts.logger?.debug?.('signal: ignoring data message from own account');
      return;
    }
    // THE allow-list gate: every session-reaching path passes through here or
    // through handleSyncSent's owner check. Unknown senders are dropped
    // silently (no reply) — answering would leak the bot's existence.
    if (!senderIds.some((id) => this.allowedSenders.has(id))) {
      this.warnDrop(`unauthorized sender (${senderIds[0] ?? 'unknown'})`);
      return;
    }
    const [firstSender] = senderIds;
    assertDefined(firstSender, 'senderIds is non-empty past the length gate above');
    const target: SendTarget = { recipient: number ?? uuid ?? firstSender };
    this.dispatchInBackground(
      this.processMessage(target, data.message ?? null, data.attachments),
      'data-message',
    );
  }

  /**
   * A sync'd copy of a message the ACCOUNT OWNER sent from another device.
   * Two jobs: (1) drop echoes of OUR OWN sends (linked devices receive the
   * account's sends back — loop protection), (2) accept the owner's
   * Note-to-Self prompts, which are allowed by default after linking.
   */
  private handleSyncSent(sent: NonNullable<NonNullable<SignalEnvelope['syncMessage']>['sentMessage']>): void {
    if (typeof sent.timestamp === 'number' && this.sentTimestamps.has(sent.timestamp)) {
      this.opts.logger?.debug?.('signal: dropping sync echo of own send');
      return;
    }
    if (sent.groupInfo) return;
    // Only the owner's own Note-to-Self drives the session. Their outbound
    // messages to OTHER people are private conversation traffic — never react.
    const dest = sent.destinationNumber ?? sent.destination ?? null;
    const isNoteToSelf = this.account != null && dest != null && dest === this.account;
    if (!isNoteToSelf) return;
    this.dispatchInBackground(
      this.processMessage({ noteToSelf: true }, sent.message ?? null, sent.attachments),
      'note-to-self',
    );
  }

  /** Voice → transcript, busy gate, then one coordinated turn. */
  private async processMessage(
    target: SendTarget,
    text: string | null,
    attachments: ReadonlyArray<SignalAttachment> | undefined,
  ): Promise<void> {
    if (!this.session) return;
    let prompt = text?.trim() ?? '';
    if (!prompt) {
      const audio = pickAudioAttachment(attachments);
      if (!audio) return; // stickers/images/reactions — nothing to run
      const transcript = await transcribeVoiceAttachment(
        {
          session: this.session,
          attachmentsDir: this.opts.attachmentsDir ?? signalCliAttachmentsDir(),
          reply: (t) => this.sendText(target, t),
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
        },
        audio,
      );
      if (!transcript) return;
      prompt = transcript;
    }

    // Atomic single-flight guard (the coordinator claims the slot BEFORE any
    // await); the turnId minted here is recorded as an own-turn id — that's
    // what mirrorForeignTurn filters on (invariant #8).
    const lease = this.turns.begin(newTurnId());
    if (!lease) {
      await this.sendText(target, 'I am still working on the previous prompt. One moment…');
      return;
    }
    this.lastTarget = target;
    try {
      await runSignalTurn(
        {
          session: this.session,
          send: (t) => this.sendText(target, t),
          sendTyping: (stop) => this.sendTyping(target, stop),
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
        },
        {
          text: prompt,
          ...(this.model ? { model: this.model } : {}),
          controller: lease.controller,
          turnId: lease.turnId,
        },
      );
    } finally {
      lease.end();
    }
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  /** Send one message and record its timestamp for the sync-echo drop. */
  private async sendText(target: SendTarget, text: string): Promise<void> {
    const rpc = this.rpc;
    if (!rpc) throw new Error('signal daemon is not running');
    const params: Record<string, unknown> =
      'noteToSelf' in target ? { noteToSelf: true, message: text } : { recipient: [target.recipient], message: text };
    const result = (await rpc.request('send', params)) as { timestamp?: unknown } | null | undefined;
    const ts = result && typeof result === 'object' ? result.timestamp : undefined;
    if (typeof ts === 'number') {
      this.sentTimestamps.add(ts);
      if (this.sentTimestamps.size > MAX_SENT_TIMESTAMPS) {
        const oldest = this.sentTimestamps.values().next().value;
        if (oldest !== undefined) this.sentTimestamps.delete(oldest);
      }
    }
  }

  private async sendTyping(target: SendTarget, stop: boolean): Promise<void> {
    const rpc = this.rpc;
    if (!rpc) return;
    const recipient = 'noteToSelf' in target ? this.account : target.recipient;
    if (!recipient) return;
    await rpc.request('sendTyping', { recipient: [recipient], ...(stop ? { stop: true } : {}) });
  }

  /**
   * Post the assistant's prose for a turn this channel did not initiate.
   * Skipped for our own turnIds (robust to async ordering / replay, invariant
   * #8) and while a turn of ours is streaming via the chunked sender.
   */
  private mirrorForeignTurn(event: MoxxyEvent): void {
    const text = this.turns.mirrorText(event);
    if (text == null) return;
    const target = this.lastTarget;
    if (!target || !this.rpc) return;
    void (async () => {
      for (const part of splitForSignal(text)) {
        await this.sendText(target, part);
      }
    })().catch((err) => {
      this.opts.logger?.warn?.('signal: mirror failed', { err: String(err) });
    });
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  /**
   * Run a handler detached from the socket read loop (an envelope handler that
   * awaited a whole turn would park notification delivery for its duration).
   * Errors are logged here — nothing upstream awaits this promise.
   */
  private dispatchInBackground(work: Promise<void>, kind: string): void {
    void work.catch((err) => {
      this.opts.logger?.warn?.('signal: handler failed', { kind, err: String(err) });
    });
  }

  private warnDrop(reason: string): void {
    const now = Date.now();
    if (now - this.lastDropWarnAt < DROP_WARN_INTERVAL_MS) return;
    this.lastDropWarnAt = now;
    this.opts.logger?.warn?.(`signal: dropped inbound envelope — ${reason}`);
  }

  private notifyConnectChange(): void {
    for (const listener of this.connectListeners) {
      try {
        listener();
      } catch (err) {
        this.opts.logger?.warn?.('signal: connect-change listener threw', { err: String(err) });
      }
    }
  }

  private settleRunning(): void {
    if (this.runningSettled) return;
    this.runningSettled = true;
    this.resolveRunning?.();
  }

  private fatal(err: Error): void {
    this.opts.logger?.error?.('signal: fatal channel error', { err: err.message });
    if (this.runningSettled) return;
    this.runningSettled = true;
    this.rejectRunning?.(err);
  }
}

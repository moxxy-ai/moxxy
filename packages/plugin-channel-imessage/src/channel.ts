import { newTurnId } from '@moxxy/core';
import { TurnCoordinator, resolveSecret } from '@moxxy/channel-kit';
import type { ClientSession as Session } from '@moxxy/sdk';
import type {
  Channel,
  ChannelHandle,
  ChannelStartOptsBase,
  MoxxyEvent,
  PermissionResolver,
} from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  IMESSAGE_ALLOWED_HANDLES_KEY,
  IMESSAGE_OWNER_HANDLES_KEY,
  IMESSAGE_SERVER_PASSWORD_ENV,
  IMESSAGE_SERVER_PASSWORD_KEY,
  IMESSAGE_SERVER_URL_ENV,
  IMESSAGE_SERVER_URL_KEY,
  normalizeHandle,
  parseHandleList,
} from './keys.js';
import { gateInboundMessage } from './message-gate.js';
import { buildImessagePermissionResolver } from './permission.js';
import {
  BlueBubblesClient,
  type BlueBubblesClientLike,
  type BlueBubblesClientOptions,
} from './bluebubbles-client.js';
import { runImessageTurn } from './channel/turn-runner.js';
import { splitForImessage } from './channel/chunker.js';

/** Bound on remembered own-send ids (guid + tempGuid) for the echo drop. */
const MAX_SENT_IDS = 256;

/** Rate limit for "dropped inbound message" warnings. */
const DROP_WARN_INTERVAL_MS = 5_000;

/** Message when the server URL / password isn't configured yet. */
const NOT_CONFIGURED_MESSAGE =
  'No BlueBubbles server configured. Run `moxxy channels imessage setup` (or set ' +
  `${IMESSAGE_SERVER_URL_ENV} + ${IMESSAGE_SERVER_PASSWORD_ENV}).`;

export interface ImessageChannelLogger {
  debug?(msg: string, meta?: Record<string, unknown>): void;
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

export interface ImessageStartOpts extends ChannelStartOptsBase {
  readonly session: Session;
  /** Override the autonomous tool allow-list at start. */
  readonly allowedTools?: ReadonlyArray<string>;
}

export interface ImessageChannelOptions {
  readonly vault: VaultStore;
  /** Server URL override; beats env + vault. */
  readonly serverUrl?: string;
  /** Server password override; beats env + vault. */
  readonly password?: string;
  /** Tools the model may call autonomously. `['*']` allows every registered tool. */
  readonly allowedTools?: ReadonlyArray<string>;
  /** Extra allow-listed handles, merged with the vault allow-list. */
  readonly allowedHandles?: ReadonlyArray<string>;
  /** Extra owner handles (self-chat identities), merged with the vault list. */
  readonly ownerHandles?: ReadonlyArray<string>;
  readonly logger?: ImessageChannelLogger;
  /** Test seam: build the BlueBubbles transport (production uses the real one). */
  readonly clientFactory?: (opts: BlueBubblesClientOptions) => BlueBubblesClientLike;
}

export class ImessageChannel implements Channel<ImessageStartOpts> {
  readonly name = 'imessage';
  /**
   * Installed on the session by the CLI dispatcher. Replaced in `start()` once
   * the live tool registry is available for `['*']` expansion; until then it
   * denies everything (safe default before start).
   */
  permissionResolver: PermissionResolver;

  private readonly opts: ImessageChannelOptions;
  private session: Session | null = null;
  private model: string | undefined;

  private client: BlueBubblesClientLike | null = null;
  private readonly allowedHandles = new Set<string>();
  private readonly ownerHandles = new Set<string>();

  // Single-flight turn state + the bounded own-turn-id set the foreign-turn
  // mirror gate filters on (invariant #8).
  private readonly turns = new TurnCoordinator();
  private lastChatGuid: string | null = null;
  private logUnsub: (() => void) | null = null;

  /**
   * guid + tempGuid of messages WE sent. BlueBubbles emits `new-message` for
   * the account's own sends too (our replies come back `isFromMe`), so any
   * inbound whose id is in this set is an echo of ourselves and must be dropped
   * (loop protection).
   */
  private readonly sentIds = new Set<string>();

  private handle: ChannelHandle | null = null;
  private runningSettled = false;
  private resolveRunning: (() => void) | null = null;
  private stopping = false;
  private lastDropWarnAt = 0;

  constructor(opts: ImessageChannelOptions) {
    this.opts = opts;
    // Pre-start: deny-all (replaced with the real allow-list resolver in start()).
    this.permissionResolver = buildImessagePermissionResolver({
      allowedTools: [],
      allToolNames: [],
      ...(opts.logger ? { logger: opts.logger } : {}),
    });
  }

  async start(startOpts: ImessageStartOpts): Promise<ChannelHandle> {
    if (this.handle) return this.handle;
    this.session = startOpts.session;
    this.model = startOpts.model;

    // Config: explicit option → env → vault (shared channel-kit precedence).
    const serverUrl =
      this.opts.serverUrl ??
      (await resolveSecret(this.opts.vault, {
        envVar: IMESSAGE_SERVER_URL_ENV,
        vaultKey: IMESSAGE_SERVER_URL_KEY,
      }));
    const password =
      this.opts.password ??
      (await resolveSecret(this.opts.vault, {
        envVar: IMESSAGE_SERVER_PASSWORD_ENV,
        vaultKey: IMESSAGE_SERVER_PASSWORD_KEY,
      }));
    if (!serverUrl || !password) throw new Error(NOT_CONFIGURED_MESSAGE);

    // Allow-list (OTHER people) + owner handles (self-chat), from vault + options.
    this.rebuildHandleSet(
      this.allowedHandles,
      parseHandleList(await this.opts.vault.get(IMESSAGE_ALLOWED_HANDLES_KEY)),
      this.opts.allowedHandles,
    );
    this.rebuildHandleSet(
      this.ownerHandles,
      parseHandleList(await this.opts.vault.get(IMESSAGE_OWNER_HANDLES_KEY)),
      this.opts.ownerHandles,
    );

    // Swap in the real autonomous allow-list resolver now that the tool registry
    // is live (mirrors Signal; `['*']` expands here).
    const allowedTools = startOpts.allowedTools ?? this.opts.allowedTools ?? [];
    const allToolNames = this.session.tools.list().map((t) => t.name);
    this.permissionResolver = buildImessagePermissionResolver({
      allowedTools,
      allToolNames,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    });
    this.session.setPermissionResolver(this.permissionResolver);

    // Mirror-to-last-chat: post assistant prose for turns this channel did NOT
    // initiate (a co-attached surface ran one) into the last chat served.
    this.logUnsub = this.session.log.subscribe((event) => this.mirrorForeignTurn(event));

    const running = new Promise<void>((resolve) => {
      this.resolveRunning = resolve;
    });

    const client = this.makeClient({ serverUrl, password });
    this.client = client;
    try {
      // Reachability + auth probe deferred to here (NOT isAvailable): surfaces a
      // friendly error if the localhost BlueBubbles server isn't up.
      await client.ping();
      await client.connect();
    } catch (err) {
      this.logUnsub?.();
      this.logUnsub = null;
      this.client = null;
      throw err;
    }
    client.onMessage((raw) => this.handleInbound(raw));

    this.handle = {
      running,
      stop: async (reason = 'shutdown') => {
        this.stopping = true;
        // Abort the in-flight turn FIRST so the model loop stops the moment the
        // operator asks to shut down. The autonomous allow-list resolver has no
        // pending operator prompts, so there is nothing to abortAll.
        this.turns.abort(reason);
        this.logUnsub?.();
        this.logUnsub = null;
        const client = this.client;
        this.client = null;
        client?.close();
        this.settleRunning();
      },
    };
    this.opts.logger?.info?.('imessage: channel started', {
      allowedHandles: this.allowedHandles.size,
      ownerHandles: this.ownerHandles.size,
    });
    return this.handle;
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  /** Every inbound `new-message` funnels through the one gate. */
  private handleInbound(raw: unknown): void {
    if (this.stopping) return;
    const verdict = gateInboundMessage(
      {
        ownerHandles: this.ownerHandles,
        allowedHandles: this.allowedHandles,
        isOwnSend: (id) => this.sentIds.has(id),
      },
      raw,
    );
    if (!verdict.ok) {
      this.warnDrop(verdict.reason);
      return;
    }
    this.dispatchInBackground(this.processMessage(verdict.chatGuid, verdict.text), 'new-message');
  }

  /** Busy gate, then one coordinated turn. */
  private async processMessage(chatGuid: string, text: string): Promise<void> {
    if (!this.session) return;
    // Atomic single-flight guard (the coordinator claims the slot BEFORE any
    // await); the turnId minted here is recorded as an own-turn id — that's what
    // mirrorForeignTurn filters on (invariant #8).
    const lease = this.turns.begin(newTurnId());
    if (!lease) {
      await this.sendText(chatGuid, 'I am still working on the previous prompt. One moment…');
      return;
    }
    this.lastChatGuid = chatGuid;
    try {
      await runImessageTurn(
        {
          session: this.session,
          send: (t) => this.sendText(chatGuid, t),
          ...(this.opts.logger ? { logger: this.opts.logger } : {}),
        },
        {
          text,
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

  /** Send one message and record its ids for the echo drop. */
  private async sendText(chatGuid: string, text: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('imessage client is not connected');
    const { guid, tempGuid } = await client.sendText(chatGuid, text);
    this.recordSent(tempGuid);
    if (guid) this.recordSent(guid);
  }

  private recordSent(id: string): void {
    this.sentIds.add(id);
    if (this.sentIds.size > MAX_SENT_IDS) {
      const oldest = this.sentIds.values().next().value;
      if (oldest !== undefined) this.sentIds.delete(oldest);
    }
  }

  /**
   * Post the assistant's prose for a turn this channel did not initiate.
   * Skipped for our own turnIds (robust to async ordering / replay, invariant
   * #8) and while a turn of ours is streaming via the chunked sender.
   */
  private mirrorForeignTurn(event: MoxxyEvent): void {
    const text = this.turns.mirrorText(event);
    if (text == null) return;
    const chatGuid = this.lastChatGuid;
    if (!chatGuid || !this.client) return;
    void (async () => {
      for (const part of splitForImessage(text)) {
        await this.sendText(chatGuid, part);
      }
    })().catch((err) => {
      this.opts.logger?.warn?.('imessage: mirror failed', { err: String(err) });
    });
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private makeClient(opts: { serverUrl: string; password: string }): BlueBubblesClientLike {
    const clientOpts: BlueBubblesClientOptions = {
      serverUrl: opts.serverUrl,
      password: opts.password,
      ...(this.opts.logger ? { logger: this.opts.logger } : {}),
    };
    const factory = this.opts.clientFactory ?? ((o) => new BlueBubblesClient(o));
    return factory(clientOpts);
  }

  private rebuildHandleSet(
    target: Set<string>,
    fromVault: ReadonlyArray<string>,
    fromOptions: ReadonlyArray<string> | undefined,
  ): void {
    target.clear();
    for (const handle of fromVault) target.add(handle);
    for (const handle of fromOptions ?? []) {
      const normalized = normalizeHandle(handle);
      if (normalized.length > 0) target.add(normalized);
    }
  }

  /**
   * Run a handler detached from the socket read loop (an inbound handler that
   * awaited a whole turn would park delivery for its duration). Errors are
   * logged here — nothing upstream awaits this promise.
   */
  private dispatchInBackground(work: Promise<void>, kind: string): void {
    void work.catch((err) => {
      this.opts.logger?.warn?.('imessage: handler failed', { kind, err: String(err) });
    });
  }

  private warnDrop(reason: string): void {
    const now = Date.now();
    if (now - this.lastDropWarnAt < DROP_WARN_INTERVAL_MS) return;
    this.lastDropWarnAt = now;
    this.opts.logger?.debug?.('imessage: dropped inbound message', { reason });
  }

  private settleRunning(): void {
    if (this.runningSettled) return;
    this.runningSettled = true;
    this.resolveRunning?.();
  }
}

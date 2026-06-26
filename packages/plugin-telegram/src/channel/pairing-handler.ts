import type { Bot, Context } from 'grammy';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  beginHostIssuedPairing,
  clearPairing,
  createPairingState,
  handleStart,
  isAuthorized,
  submitChatCode,
  type PairingDecision,
  type PairingState,
} from '../pairing.js';
import { parseChatId, TELEGRAM_AUTHORIZED_CHAT_KEY } from '../keys.js';

const AUTHORIZED_CHAT_KEY = TELEGRAM_AUTHORIZED_CHAT_KEY;

/** Result returned by `confirmChatCode`. */
export type PairingConfirmResult =
  | { ok: true; chatId: number }
  | { ok: false; reason: 'mismatch' | 'expired' | 'not-pending' | 'no-window'; message: string };

export interface PairingHandlerOptions {
  readonly vault: VaultStore;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Owns the pairing state machine + the bot-side `/start` handler for the
 * host-issued QR pairing flow (see {@link beginHostWindow}). Keeps the bot
 * reference (re-)settable so the TelegramChannel can wire it up after
 * construction.
 */
export class PairingHandler {
  private state: PairingState = createPairingState();
  private bot: Bot | null = null;
  private readonly opts: PairingHandlerOptions;
  private readonly pairedListeners = new Set<(chatId: number) => void>();

  constructor(opts: PairingHandlerOptions) {
    this.opts = opts;
  }

  attachBot(bot: Bot | null): void {
    this.bot = bot;
  }

  async loadAuthorized(): Promise<void> {
    const authorizedRaw = await this.opts.vault.get(AUTHORIZED_CHAT_KEY);
    const authorizedChatId = parseChatId(authorizedRaw);
    if (authorizedChatId == null && authorizedRaw) {
      this.opts.logger?.warn('telegram pairing: stored chat id is not a number — treating as unpaired', {
        raw: authorizedRaw,
      });
    }
    this.state = createPairingState({ authorizedChatId });
  }

  isAuthorized(chatId: number): boolean {
    return isAuthorized(this.state, chatId);
  }

  phase(): PairingState['phase'] {
    return this.state.phase;
  }

  /**
   * Open a host-issued pairing window and return the code to embed in the
   * `t.me/<bot>?start=<code>` deep link / QR the control surface renders. The
   * user proves ownership by presenting THIS code back to the bot (deep-link tap
   * or a plain message), which `handleStartCommand` / `confirmChatCode`
   * validate. Returns the generated code.
   */
  beginHostWindow(): string {
    const { state, code } = beginHostIssuedPairing(this.state);
    this.state = state;
    return code;
  }

  unpair(): void {
    this.state = clearPairing(this.state);
  }

  /**
   * Subscribe to "a chat just became authorized" — fires once each time pairing
   * completes. The channel uses this to publish its "connected" connect-state so
   * a watching control surface can swap the QR for a "✓ Connected" affordance,
   * and the `pair` terminal command uses it to know pairing finished. Returns an
   * unsubscribe function.
   */
  onPaired(listener: (chatId: number) => void): () => void {
    this.pairedListeners.add(listener);
    return () => this.pairedListeners.delete(listener);
  }

  /**
   * A chat presented a code (deep-link `/start <code>` payload or a plain 6-digit
   * message). On match the chat is authorized, persisted to the vault, and
   * greeted. Returns a structured result the caller can branch on.
   */
  async confirmChatCode(chatId: number, rawCode: string): Promise<PairingConfirmResult> {
    const decision = submitChatCode(this.state, chatId, rawCode);
    return this.applyConfirmDecision(decision);
  }

  /** Persist + greet + notify on a 'paired' decision; map every decision kind to
   *  a {@link PairingConfirmResult}. */
  private async applyConfirmDecision(decision: PairingDecision): Promise<PairingConfirmResult> {
    this.state = decision.state;
    const action = decision.action;
    if (action.kind === 'paired') {
      await this.opts.vault.set(AUTHORIZED_CHAT_KEY, String(action.chatId));
      // Greet the chat that just got authorized so the user has a confirmation
      // on the Telegram side too — symmetric with the success the surface shows.
      if (this.bot) {
        try {
          await this.bot.api.sendMessage(
            action.chatId,
            '✅ Paired with moxxy. Send a prompt to begin.',
          );
        } catch (err) {
          this.opts.logger?.warn('pairing: greeting send failed', { err: String(err) });
        }
      }
      this.emitPaired(action.chatId);
      return { ok: true, chatId: action.chatId };
    }
    if (action.kind === 'still-paired') return { ok: true, chatId: action.chatId };
    if (action.kind === 'mismatch') return { ok: false, reason: 'mismatch', message: action.message };
    if (action.kind === 'expired') return { ok: false, reason: 'expired', message: action.message };
    if (action.kind === 'not-pending') return { ok: false, reason: 'not-pending', message: action.message };
    if (action.kind === 'reject') return { ok: false, reason: 'not-pending', message: action.message };
    return { ok: false, reason: 'mismatch', message: 'unexpected pairing state' };
  }

  private emitPaired(chatId: number): void {
    for (const listener of this.pairedListeners) {
      try {
        listener(chatId);
      } catch (err) {
        this.opts.logger?.warn('pairing paired-listener threw', { err: String(err) });
      }
    }
  }

  /** Bot-side `/start` handler. */
  async handleStartCommand(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Host-issued direction: the deep link the user scanned carries the code as
    // the /start payload (grammy exposes it as `ctx.match`). Validate it here so
    // "scan QR → tap START → paired" needs no typing. A bare /start (no payload —
    // e.g. the user opened the chat manually) falls through to `handleStart`,
    // which nudges them to use the link or send the digits (the message handler
    // also accepts a bare 6-digit code).
    if (this.state.phase === 'awaiting-host-code') {
      const payload = typeof ctx.match === 'string' ? ctx.match.trim() : '';
      if (payload) {
        const result = await this.confirmChatCode(chatId, payload);
        if (!result.ok && result.reason !== 'not-pending') {
          await ctx.reply(result.message);
        }
        return;
      }
    }

    const decision: PairingDecision = handleStart(this.state, chatId);
    this.state = decision.state;
    const action = decision.action;
    if (action.kind === 'still-paired') {
      await ctx.reply('Welcome back! Send me a prompt.');
      return;
    }
    if (action.kind === 'reject' || action.kind === 'expired') {
      await ctx.reply(action.message);
    }
  }
}

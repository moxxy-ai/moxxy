import type { VaultStore } from '@moxxy/plugin-vault';
import {
  armPairing,
  clearDiscordPairing,
  confirmPendingCode,
  createDiscordPairingState,
  isUserAuthorized,
  mintCodeForPeer,
  pairingPhase,
  type DiscordPairingDecision,
  type DiscordPairingPhase,
  type DiscordPairingState,
} from '../pairing.js';
import { DISCORD_AUTHORIZED_USER_KEY, parseAuthorizedUser } from '../keys.js';

/** Result returned by {@link PairingHandler.confirmCode}. */
export type PairingConfirmResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'mismatch' | 'expired' | 'not-pending'; message: string };

export interface PairingHandlerOptions {
  readonly vault: VaultStore;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Owns the pairing state machine + vault persistence for the DM code flow
 * (see `../pairing.ts` for the flow + security property). The channel feeds it
 * DMs from unauthorized users ({@link handleUnpairedDm}) and the terminal
 * wizard feeds it pasted codes ({@link confirmCode}).
 */
export class PairingHandler {
  private state: DiscordPairingState = createDiscordPairingState();
  private readonly opts: PairingHandlerOptions;
  private readonly pairedListeners = new Set<(userId: string) => void>();

  constructor(opts: PairingHandlerOptions) {
    this.opts = opts;
  }

  async loadAuthorized(): Promise<void> {
    const raw = await this.opts.vault.get(DISCORD_AUTHORIZED_USER_KEY);
    const authorizedUserId = parseAuthorizedUser(raw);
    if (authorizedUserId == null && raw) {
      this.opts.logger?.warn(
        'discord pairing: stored user id is not a snowflake — treating as unpaired',
        { raw },
      );
    }
    this.state = createDiscordPairingState({ authorizedUserId });
  }

  phase(): DiscordPairingPhase {
    return pairingPhase(this.state);
  }

  isAuthorized(userId: string): boolean {
    return isUserAuthorized(this.state, userId);
  }

  authorizedUserId(): string | null {
    return this.state.kit.phase === 'paired' ? this.state.kit.authorizedPeer : null;
  }

  /** Arm the pairing window: unauthorized DMs will now be issued codes. */
  arm(): void {
    this.state = armPairing(this.state);
  }

  unpair(): void {
    this.state = clearDiscordPairing(this.state);
  }

  /**
   * Subscribe to "a user just became authorized" — fires once each time pairing
   * completes. The `pair` terminal flow uses it to print success; the channel
   * uses it to flip its connect-state. Returns an unsubscribe function.
   */
  onPaired(listener: (userId: string) => void): () => void {
    this.pairedListeners.add(listener);
    return () => this.pairedListeners.delete(listener);
  }

  /**
   * An unauthorized user DMed the bot. Returns the reply text to DM back:
   * a freshly minted one-time code (window armed), a nudge to open a window,
   * or a foreign-account rejection. Null when no reply is warranted.
   */
  handleUnpairedDm(userId: string): string | null {
    const decision = mintCodeForPeer(this.state, userId);
    this.state = decision.state;
    const action = decision.action;
    if (action.kind === 'code-minted') {
      this.opts.logger?.info?.('discord pairing: code minted', { userId });
      return (
        `Your one-time pairing code is: **${action.code}**\n` +
        'Paste it into the moxxy terminal (`moxxy discord pair`) to finish pairing.'
      );
    }
    if (action.kind === 'still-paired') return 'Already paired — send me a prompt.';
    if (action.kind === 'reject') return action.message;
    return null;
  }

  /**
   * The operator pasted a code into the terminal. On match the pending DM user
   * is authorized + persisted. The vault write happens BEFORE listeners fire so
   * a `pair`-flow exit right after success never loses the pairing.
   */
  async confirmCode(rawCode: string): Promise<PairingConfirmResult> {
    const decision = confirmPendingCode(this.state, rawCode);
    return this.applyConfirmDecision(decision);
  }

  private async applyConfirmDecision(
    decision: DiscordPairingDecision,
  ): Promise<PairingConfirmResult> {
    this.state = decision.state;
    const action = decision.action;
    if (action.kind === 'paired') {
      await this.opts.vault.set(DISCORD_AUTHORIZED_USER_KEY, action.userId);
      this.emitPaired(action.userId);
      return { ok: true, userId: action.userId };
    }
    if (action.kind === 'still-paired') return { ok: true, userId: action.userId };
    if (action.kind === 'mismatch') return { ok: false, reason: 'mismatch', message: action.message };
    if (action.kind === 'expired') return { ok: false, reason: 'expired', message: action.message };
    if (action.kind === 'not-pending' || action.kind === 'reject') {
      return { ok: false, reason: 'not-pending', message: action.message };
    }
    // 'code-minted' can't come out of a confirm; treat as a mismatch.
    return { ok: false, reason: 'mismatch', message: 'unexpected pairing state' };
  }

  private emitPaired(userId: string): void {
    for (const listener of this.pairedListeners) {
      try {
        listener(userId);
      } catch (err) {
        this.opts.logger?.warn('discord pairing paired-listener threw', { err: String(err) });
      }
    }
  }
}

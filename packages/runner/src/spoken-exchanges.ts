import type { Session } from '@moxxy/core';
import { newTurnId } from '@moxxy/core';
import type { TurnId } from '@moxxy/sdk';

export interface SpokenExchange {
  readonly userText?: string;
  readonly assistantText?: string;
}

/**
 * Voice conversation recorded into the chat (`session.recordExchange`).
 *
 * The agent re-reads the whole log before every model call, so an exchange
 * appended while a turn runs would land inside that turn's context, between
 * its tool steps. Exchanges spoken during a turn are held and appended, in
 * order, once no turn is running — the same rule typed messages follow in the
 * chat queue.
 */
export class SpokenExchanges {
  private readonly held: Array<{ readonly turnId: TurnId; readonly exchange: SpokenExchange }> = [];

  constructor(
    private readonly session: Session,
    private readonly turnRunning: () => boolean,
  ) {}

  async record(exchange: SpokenExchange): Promise<TurnId> {
    const turnId = newTurnId();
    if (this.turnRunning() || this.held.length > 0) {
      this.held.push({ turnId, exchange });
      await this.flush();
      return turnId;
    }
    await this.append(turnId, exchange);
    return turnId;
  }

  /** Append what was held; call once a turn has finished. */
  async flush(): Promise<void> {
    while (!this.turnRunning()) {
      const next = this.held.shift();
      if (!next) return;
      await this.append(next.turnId, next.exchange);
    }
  }

  private async append(turnId: TurnId, { userText, assistantText }: SpokenExchange): Promise<void> {
    const base = { sessionId: this.session.id, turnId } as const;
    if (userText?.trim()) {
      await this.session.log.append({ ...base, type: 'user_prompt', source: 'user', text: userText });
    }
    if (assistantText?.trim()) {
      await this.session.log.append({
        ...base,
        type: 'assistant_message',
        source: 'model',
        content: assistantText,
        stopReason: 'end_turn',
      });
    }
  }
}

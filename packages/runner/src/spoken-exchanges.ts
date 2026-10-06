import type { Session } from '@moxxy/core';
import { newTurnId } from '@moxxy/core';
import type { TurnId } from '@moxxy/sdk';

export interface SpokenExchange {
  readonly userText?: string;
  readonly assistantText?: string;
}

interface HeldConversation {
  readonly turnId: TurnId;
  readonly exchanges: SpokenExchange[];
}

/**
 * Voice conversation recorded into the chat (`session.recordExchange`).
 *
 * The agent re-reads the whole log before every model call, so an exchange
 * appended while a turn runs would land inside that turn's context, between
 * its tool steps. Exchanges spoken during a turn are held and, once no turn
 * runs, appended as ONE transcript prompt (`origin.kind: 'voice'`) — context
 * for later turns, not a request, rendered as a single collapsed block.
 * Conversation while the agent is idle is recorded as ordinary turns.
 */
export class SpokenExchanges {
  private held: HeldConversation | null = null;

  constructor(
    private readonly session: Session,
    private readonly turnRunning: () => boolean,
  ) {}

  async record(exchange: SpokenExchange): Promise<TurnId> {
    if (this.turnRunning()) {
      this.held ??= { turnId: newTurnId(), exchanges: [] };
      this.held.exchanges.push(exchange);
      return this.held.turnId;
    }
    await this.flush();
    const turnId = newTurnId();
    await this.appendExchange(turnId, exchange);
    return turnId;
  }

  /** Append the conversation held during the turn that just finished. */
  async flush(): Promise<void> {
    const held = this.held;
    if (!held || this.turnRunning()) return;
    this.held = null;
    const count = held.exchanges.length;
    await this.session.log.append({
      sessionId: this.session.id,
      turnId: held.turnId,
      type: 'user_prompt',
      source: 'user',
      text: voiceTranscript(held.exchanges),
      origin: { kind: 'voice', name: `${count} ${count === 1 ? 'exchange' : 'exchanges'} while the agent worked` },
    });
  }

  private async appendExchange(turnId: TurnId, { userText, assistantText }: SpokenExchange): Promise<void> {
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

function voiceTranscript(exchanges: ReadonlyArray<SpokenExchange>): string {
  const lines = exchanges.map(({ userText, assistantText }) =>
    [
      userText?.trim() ? `User: ${userText.trim()}` : null,
      assistantText?.trim() ? `Moxxy Voice: ${assistantText.trim()}` : null,
    ].filter((line) => line !== null).join('\n'));
  return [
    'Voice conversation with Moxxy Voice while the agent was working (a record for context, not a request):',
    ...lines,
  ].join('\n\n');
}

import {
  QUESTION_CLOSED_AGENT_WENT_ON,
  QUESTION_CLOSED_NEW_MESSAGE,
  chooseOption,
  draftAnswers,
  emptyDraft,
  openQuestionsFromEvents,
  questionAnswersProblem,
  questionRecord,
  typeOwnAnswer,
  type ClientSession,
  type MoxxyEvent,
  type OpenQuestion,
  type QuestionAnswers,
  type QuestionDraft,
  type QuestionItem,
  type QuestionOutcome,
} from '@moxxy/sdk';

/** Every Question button's data starts with this, so a bot can route clicks. */
export const QUESTION_BUTTON_PREFIX = 'q:';

export interface QuestionButton {
  /** An answer to pick, or Send for a card that collects picks first. */
  readonly kind: 'answer' | 'send';
  readonly label: string;
  /** Opaque click payload (≤ 40 bytes: fits Telegram's 64 and Discord's 100). */
  readonly data: string;
  readonly chosen: boolean;
}

/** A Question as a chat message: its text and its rows of buttons (none once closed). */
export interface QuestionCard {
  readonly questionId: string;
  readonly text: string;
  readonly rows: ReadonlyArray<ReadonlyArray<QuestionButton>>;
}

export type QuestionUpdate =
  /** A new question: send the card. */
  | { readonly kind: 'show'; readonly card: QuestionCard }
  /** Picks changed: edit the card in place. */
  | { readonly kind: 'refresh'; readonly card: QuestionCard }
  /** Answered (here or on another surface) or closed by a stopped turn: edit the card, drop its buttons. */
  | { readonly kind: 'closed'; readonly card: QuestionCard }
  /** Why the person's last click or reply did not go out. */
  | { readonly kind: 'problem'; readonly text: string };

interface Held {
  readonly question: OpenQuestion;
  draft: QuestionDraft;
}

/**
 * A chat bot's Questions. The open questions are read from the session's log,
 * so the bot shows the same ones as every other client of the conversation and
 * the first answer from any of them closes the card everywhere. Clicks and a
 * typed reply put the answer together; the bot only draws the cards this
 * hands it (an inline keyboard, a row of Discord buttons).
 *
 * A single question with one answer goes out on the click; otherwise picks are
 * marked and a Send button sends them all together.
 */
export class ChatQuestions {
  private readonly held = new Map<string, Held>();
  private emit: (update: QuestionUpdate) => void = () => undefined;

  constructor(private readonly session: () => ClientSession | null) {}

  /** Show this conversation's Questions; returns the detach. */
  attach(onUpdate: (update: QuestionUpdate) => void): () => void {
    const session = this.session();
    if (!session || !session.questions) return () => undefined;
    this.emit = onUpdate;
    const detachSurface = session.questions.attachSurface();
    const unsubscribe = session.log.subscribe((event) => this.accept(event));
    for (const open of openQuestionsFromEvents(session.log.ofType('plugin_event'))) this.show(open);
    return () => {
      unsubscribe();
      detachSurface();
      this.held.clear();
      this.emit = () => undefined;
    };
  }

  /** A button click; data that is not a Question button is ignored. */
  async press(data: string): Promise<void> {
    if (!data.startsWith(QUESTION_BUTTON_PREFIX)) return;
    const [questionId = '', at = '', option = ''] = data.slice(QUESTION_BUTTON_PREFIX.length).split(':');
    const held = this.held.get(questionId);
    if (!held) {
      this.emit({ kind: 'problem', text: 'This question is no longer open.' });
      return;
    }
    if (at === 'send') {
      await this.send(held);
      return;
    }
    const item = held.question.questions[Number(at)];
    const picked = item ? item.options[Number(option)] : undefined;
    if (!item || !picked) return;
    held.draft = chooseOption(held.draft, item, picked.id);
    if (answersOnClick(held.question)) await this.send(held);
    else this.emit({ kind: 'refresh', card: openCard(held) });
  }

  /**
   * A typed reply. It answers the latest open question that takes words of the
   * person's own; returns false when none does, so the bot treats it as a prompt.
   */
  async typed(text: string): Promise<boolean> {
    const words = text.trim();
    const held = [...this.held.values()].at(-1);
    if (!held || words === '') return false;
    const answers = draftAnswers(held.draft);
    const takers = held.question.questions.filter((item) => item.allowOther);
    const item = takers.find((each) => !isAnswered(answers, each)) ?? takers.at(-1);
    if (!item) return false;
    held.draft = typeOwnAnswer(held.draft, item, words);
    if (questionAnswersProblem(held.question.questions, draftAnswers(held.draft)) === null) await this.send(held);
    else this.emit({ kind: 'refresh', card: openCard(held) });
    return true;
  }

  private accept(event: MoxxyEvent): void {
    const record = questionRecord(event);
    if (!record) return;
    if (record.kind === 'asked') {
      this.show({ questionId: record.questionId, turnId: record.turnId, questions: record.questions });
      return;
    }
    const held = this.held.get(record.questionId);
    if (!held) return;
    this.held.delete(record.questionId);
    this.emit({ kind: 'closed', card: closedCard(held.question, record.outcome) });
  }

  private show(question: OpenQuestion): void {
    if (this.held.has(question.questionId)) return;
    const held = { question, draft: emptyDraft(question.questions) };
    this.held.set(question.questionId, held);
    this.emit({ kind: 'show', card: openCard(held) });
  }

  private async send(held: Held): Promise<void> {
    const answers = draftAnswers(held.draft);
    const problem = questionAnswersProblem(held.question.questions, answers);
    if (problem) {
      this.emit({ kind: 'problem', text: problem });
      return;
    }
    const session = this.session();
    try {
      if (!session || !session.questions) throw new Error('This question is no longer open.');
      // The card closes when the answer lands in the log, the same way as for an answer given elsewhere.
      await session.questions.answer(held.question.questionId, answers);
    } catch (err) {
      this.emit({ kind: 'problem', text: err instanceof Error ? err.message : String(err) });
    }
  }
}

function answersOnClick(question: OpenQuestion): boolean {
  const [only] = question.questions;
  return question.questions.length === 1 && only !== undefined && !only.multiSelect;
}

function isAnswered(answers: QuestionAnswers, item: QuestionItem): boolean {
  const answer = answers[item.id];
  return answer !== undefined && (answer.selected.length > 0 || answer.other !== undefined);
}

function openCard({ question, draft }: Held): QuestionCard {
  const many = question.questions.length > 1;
  const lines = [many ? '❓ Questions' : '❓ Question'];
  question.questions.forEach((item, at) => {
    lines.push('', `${many ? `${at + 1}. ` : ''}${asked(item)}${item.multiSelect ? ' (choose any)' : ''}`);
    for (const option of item.options) {
      lines.push(`• ${option.label}${option.description ? ` (${option.description})` : ''}`);
    }
    const own = draft[item.id];
    if (own && own.other.trim() !== '') lines.push(`Your own answer: ${own.other.trim()}`);
  });
  if (question.questions.some((item) => item.allowOther)) lines.push('', 'Or reply with your own answer.');

  const rows: QuestionButton[][] = question.questions.map((item, at) =>
    item.options.map((option, index) => {
      const own = draft[item.id];
      const chosen = own ? own.selected.includes(option.id) : false;
      return {
        kind: 'answer' as const,
        label: chosen ? `✓ ${option.label}` : option.label,
        data: `${QUESTION_BUTTON_PREFIX}${question.questionId}:${at}:${index}`,
        chosen,
      };
    }),
  );
  if (!answersOnClick(question)) {
    rows.push([{ kind: 'send', label: 'Send', data: `${QUESTION_BUTTON_PREFIX}${question.questionId}:send`, chosen: false }]);
  }
  return { questionId: question.questionId, text: lines.join('\n'), rows: rows.filter((row) => row.length > 0) };
}

function closedCard(question: OpenQuestion, outcome: QuestionOutcome): QuestionCard {
  const many = question.questions.length > 1;
  const head = question.questions.map((item, at) => `${many ? `${at + 1}. ` : ''}${asked(item)}`);
  if (outcome.kind !== 'answered') {
    return { questionId: question.questionId, text: [...head, '', `✕ Closed: ${whyClosed(outcome)}`].join('\n'), rows: [] };
  }
  const chosen = question.questions.map((item, at) => {
    const answer = outcome.answers[item.id];
    const labels = answer
      ? answer.selected.map((id) => item.options.find((option) => option.id === id)?.label ?? id)
      : [];
    const words = answer && answer.other !== undefined ? [answer.other] : [];
    return `${many ? `${at + 1}. ` : ''}${[...labels, ...words].join(', ')}`;
  });
  const said = many ? ['✓ Answered:', ...chosen] : [`✓ Answered: ${chosen.join('')}`];
  return { questionId: question.questionId, text: [...head, '', ...said].join('\n'), rows: [] };
}

function whyClosed(outcome: QuestionOutcome): string {
  if (outcome.kind === 'dismissed' && outcome.note === QUESTION_CLOSED_AGENT_WENT_ON) return 'the agent went on without an answer.';
  if (outcome.kind === 'dismissed' && outcome.note === QUESTION_CLOSED_NEW_MESSAGE) return 'a new message was sent instead.';
  return 'the turn stopped.';
}

function asked(item: QuestionItem): string {
  return `${item.header ? `${item.header}: ` : ''}${item.question}`;
}

import { z } from 'zod/v3';
import type { MoxxyEvent } from './events.js';
import { asPluginId, type TurnId } from './ids.js';
import type { QuestionAnswerDisplay } from './tool-display.js';

/**
 * A Question is the agent asking the person to choose or answer: it blocks no
 * action and auto-approve never answers it. It belongs to the conversation, not
 * to one client: asking and resolving are recorded in the event log as
 * `plugin_event`s, so every surface attached to the session shows the same open
 * question, and the first answer from any of them closes it everywhere.
 */
export const QUESTION_PLUGIN_ID = asPluginId('@moxxy/question');
export const QUESTION_ASKED = 'question_asked';
export const QUESTION_RESOLVED = 'question_resolved';

export interface QuestionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface QuestionItem {
  readonly id: string;
  /** A short tag for the question, as Claude's AskUserQuestion and Codex send it. */
  readonly header?: string;
  readonly question: string;
  /** Empty when only an answer of the person's own fits. */
  readonly options: ReadonlyArray<QuestionOption>;
  readonly multiSelect: boolean;
  /** Whether the person may answer in their own words instead of an option. */
  readonly allowOther: boolean;
}

/** The ids of the options chosen, and the words typed when the question takes them. */
export interface QuestionAnswer {
  readonly selected: ReadonlyArray<string>;
  readonly other?: string;
}

export type QuestionAnswers = Readonly<Record<string, QuestionAnswer>>;

export type QuestionOutcome =
  | { readonly kind: 'answered'; readonly answers: QuestionAnswers }
  /** The turn waiting on it stopped before anyone answered. */
  | { readonly kind: 'dismissed'; readonly reason: 'cancelled' }
  /** No surface that can show a question is attached, so nobody will answer. */
  | { readonly kind: 'unanswerable' };

/** Asks the person and waits: answered, stopped with the turn, or nobody attached to answer. */
export type QuestionAsker = (request: {
  readonly turnId: TurnId;
  readonly questions: ReadonlyArray<QuestionItem>;
  readonly signal: AbortSignal;
}) => Promise<QuestionOutcome>;

/** The session's side of questions that a surface (desktop, TUI, a channel bot) drives. */
export interface SessionQuestions {
  /** Say this surface can show questions and take answers; call the result when it detaches. */
  attachSurface(): () => void;
  /** Answer an open question. Rejects when it is no longer open or the answer does not fit it. */
  answer(questionId: string, answers: QuestionAnswers): Promise<void>;
}

export const questionOptionSchema = z
  .object({ id: z.string().min(1), label: z.string().min(1), description: z.string().optional() })
  .strict();

export const questionItemSchema = z
  .object({
    id: z.string().min(1),
    header: z.string().optional(),
    question: z.string().min(1),
    options: z.array(questionOptionSchema),
    multiSelect: z.boolean(),
    allowOther: z.boolean(),
  })
  .strict()
  .refine((item) => item.options.length > 0 || item.allowOther, 'A question without options must take an answer of the person own.');

export const questionAnswerSchema = z
  .object({ selected: z.array(z.string()), other: z.string().optional() })
  .strict();

export const questionAnswersSchema = z.record(questionAnswerSchema);

const askedSchema = z.object({ questionId: z.string().min(1), questions: z.array(questionItemSchema).min(1) });
const resolvedSchema = z.union([
  z.object({ questionId: z.string().min(1), answers: questionAnswersSchema }),
  z.object({ questionId: z.string().min(1), dismissed: z.literal('cancelled') }),
]);

export type QuestionRecord =
  | {
      readonly kind: 'asked';
      readonly questionId: string;
      readonly turnId: string;
      readonly questions: ReadonlyArray<QuestionItem>;
    }
  | {
      readonly kind: 'resolved';
      readonly questionId: string;
      readonly outcome: Extract<QuestionOutcome, { kind: 'answered' | 'dismissed' }>;
    };

/** What a question record in the log says, or null when the event is not one. */
export function questionRecord(event: MoxxyEvent): QuestionRecord | null {
  if (event.type !== 'plugin_event' || event.pluginId !== QUESTION_PLUGIN_ID) return null;
  if (event.subtype === QUESTION_ASKED) {
    const parsed = askedSchema.safeParse(event.payload);
    if (!parsed.success) return null;
    return { kind: 'asked', questionId: parsed.data.questionId, turnId: String(event.turnId), questions: parsed.data.questions };
  }
  if (event.subtype === QUESTION_RESOLVED) {
    const parsed = resolvedSchema.safeParse(event.payload);
    if (!parsed.success) return null;
    const outcome =
      'answers' in parsed.data
        ? ({ kind: 'answered', answers: parsed.data.answers } as const)
        : ({ kind: 'dismissed', reason: parsed.data.dismissed } as const);
    return { kind: 'resolved', questionId: parsed.data.questionId, outcome };
  }
  return null;
}

export interface OpenQuestion {
  readonly questionId: string;
  readonly turnId: string;
  readonly questions: ReadonlyArray<QuestionItem>;
}

/** The questions asked and not yet resolved, oldest first: a pure fold over the log. */
export function openQuestionsFromEvents(events: ReadonlyArray<MoxxyEvent>): ReadonlyArray<OpenQuestion> {
  const open = new Map<string, OpenQuestion>();
  for (const event of events) {
    const found = questionRecord(event);
    if (!found) continue;
    if (found.kind === 'asked') {
      open.set(found.questionId, { questionId: found.questionId, turnId: found.turnId, questions: found.questions });
    } else {
      open.delete(found.questionId);
    }
  }
  return [...open.values()];
}

/** Why `answers` cannot answer `questions`, in one line, or null when they can. */
export function questionAnswersProblem(
  questions: ReadonlyArray<QuestionItem>,
  answers: QuestionAnswers,
): string | null {
  const known = new Set(questions.map((item) => item.id));
  const stray = Object.keys(answers).find((id) => !known.has(id));
  if (stray !== undefined) return `There is no question "${stray}".`;

  for (const item of questions) {
    const answer = answers[item.id];
    const other = typedWords(answer);
    const chosen = answer ? answer.selected.length : 0;
    if (chosen === 0 && other === '') return `No answer to "${item.question}".`;
    if (answer === undefined) continue;
    const offered = new Set(item.options.map((option) => option.id));
    const unknown = answer.selected.find((id) => !offered.has(id));
    if (unknown !== undefined) return `"${item.question}" has no answer "${unknown}".`;
    if (other !== '' && !item.allowOther) return `"${item.question}" takes only the answers it offers.`;
    if (!item.multiSelect && chosen + (other === '' ? 0 : 1) > 1) return `"${item.question}" takes one answer.`;
  }
  return null;
}

/** The person's answers as the agent reads them: each question quoted with what was chosen. */
export function describeQuestionAnswers(questions: ReadonlyArray<QuestionItem>, answers: QuestionAnswers): string {
  const lines = questions.map((item) => {
    const answer = answers[item.id];
    const labels = (answer?.selected ?? []).map((id) => item.options.find((option) => option.id === id)?.label ?? id);
    const other = typedWords(answer);
    const parts = [...(labels.length > 0 ? [labels.join(', ')] : []), ...(other ? [`their own answer: ${other}`] : [])];
    return `- "${item.question}" → ${parts.join('; ')}`;
  });
  return ['The user answered:', ...lines].join('\n');
}

/** The answers as the transcript shows them: each question with the labels picked and any words of the person's own. */
export function questionAnswerDisplay(questions: ReadonlyArray<QuestionItem>, answers: QuestionAnswers): QuestionAnswerDisplay {
  return {
    kind: 'question-answer',
    questions: questions.map((item) => {
      const answer = answers[item.id];
      const chosen = (answer?.selected ?? []).map((id) => item.options.find((option) => option.id === id)?.label ?? id);
      const own = typedWords(answer);
      return {
        ...(item.header ? { header: item.header } : {}),
        question: item.question,
        chosen,
        ...(own ? { own } : {}),
      };
    }),
  };
}

function typedWords(answer: QuestionAnswer | undefined): string {
  return answer && answer.other !== undefined ? answer.other.trim() : '';
}

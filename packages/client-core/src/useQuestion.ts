import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  chooseOption,
  draftAnswers,
  emptyDraft,
  questionAnswersProblem,
  typeOwnAnswer,
  type OpenQuestion,
  type QuestionDraft,
  type QuestionItem,
} from '@moxxy/sdk/questions';
import { chatStore, EMPTY_SNAPSHOT } from './chatStore.js';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import { pendingQuestion } from './question-draft.js';

export interface UseQuestion {
  /** The open Question of the running turn, or null. */
  readonly question: OpenQuestion | null;
  readonly draft: QuestionDraft;
  /** Why the answer cannot be sent yet, in one line; null when it can. */
  readonly problem: string | null;
  readonly sending: boolean;
  /** Why the last answer did not go through (another client answered first, the runner went away). */
  readonly error: string | null;
  choose(item: QuestionItem, optionId: string): void;
  type(item: QuestionItem, text: string): void;
  submit(): Promise<void>;
}

const NO_DRAFT: QuestionDraft = Object.freeze({});

/**
 * The open Question of a chat and the answer being put together for it. The
 * question is read from the chat's events, so every client of the conversation
 * shows the same one; the first answer, from any of them, closes it everywhere.
 */
export function useQuestion(workspaceId: string | null): UseQuestion {
  const snap = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getChat(workspaceId) : EMPTY_SNAPSHOT,
  );
  const question = useMemo(() => pendingQuestion(snap.events, snap.activeTurnId), [snap.events, snap.activeTurnId]);
  const questionId = question ? question.questionId : null;

  // Keyed by question, so the next question starts from a fresh answer.
  const [held, setHeld] = useState<{ readonly questionId: string | null; readonly draft: QuestionDraft }>({
    questionId: null,
    draft: NO_DRAFT,
  });
  const [status, setStatus] = useState<{ readonly sending: boolean; readonly error: string | null }>({
    sending: false,
    error: null,
  });

  const draft = useMemo(() => {
    if (!question) return NO_DRAFT;
    return held.questionId === question.questionId ? held.draft : emptyDraft(question.questions);
  }, [question, held]);
  const problem = question ? questionAnswersProblem(question.questions, draftAnswers(draft)) : null;

  const update = useCallback(
    (change: (current: QuestionDraft) => QuestionDraft) => {
      if (questionId === null) return;
      setHeld({ questionId, draft: change(draft) });
      setStatus((current) => (current.error === null ? current : { ...current, error: null }));
    },
    [questionId, draft],
  );

  const choose = useCallback(
    (item: QuestionItem, optionId: string) => update((current) => chooseOption(current, item, optionId)),
    [update],
  );
  const type = useCallback(
    (item: QuestionItem, text: string) => update((current) => typeOwnAnswer(current, item, text)),
    [update],
  );

  const submit = useCallback(async () => {
    if (!workspaceId || questionId === null || problem !== null || status.sending) return;
    setStatus({ sending: true, error: null });
    try {
      await api().invoke('session.answerQuestion', { workspaceId, questionId, answers: draftAnswers(draft) });
      setStatus({ sending: false, error: null });
    } catch (e) {
      setStatus({ sending: false, error: toErrorMessage(e) });
    }
  }, [workspaceId, questionId, problem, status.sending, draft]);

  return { question, draft, problem, sending: status.sending, error: status.error, choose, type, submit };
}

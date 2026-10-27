import { useEffect, useMemo, useState } from 'react';
import type { ClientSession as Session, MoxxyEvent, OpenQuestion, QuestionAnswers } from '@moxxy/sdk';
import { flowKey, flowProblem, startFlow, type FlowKey, type QuestionFlow } from './question-flow.js';
import { attachQuestions, openQuestionIn, sendAnswer } from './question-session.js';

export interface TuiQuestion {
  readonly question: OpenQuestion;
  readonly flow: QuestionFlow;
  /** Why the answer cannot go out yet; null once it fits. */
  readonly problem: string | null;
  readonly sending: boolean;
  /** Why the last answer did not go through. */
  readonly error: string | null;
  press(key: FlowKey): void;
}

/**
 * The open Question of the conversation and the answer being put together for
 * it in the terminal. The question is read from the events, so the terminal
 * shows the same one every other client of the conversation does.
 */
export function useQuestion(session: Session, events: ReadonlyArray<MoxxyEvent>): TuiQuestion | null {
  useEffect(() => attachQuestions(session), [session]);
  const question = useMemo(() => openQuestionIn(events), [events]);
  const [held, setHeld] = useState<QuestionFlow | null>(null);
  const [status, setStatus] = useState<{ readonly sending: boolean; readonly error: string | null }>({
    sending: false,
    error: null,
  });

  if (!question) return null;
  const flow = held && held.questionId === question.questionId ? held : startFlow(question);
  const send = (answers: QuestionAnswers): void => {
    setStatus({ sending: true, error: null });
    void sendAnswer(session, question.questionId, answers).then((error) => setStatus({ sending: false, error }));
  };
  return {
    question,
    flow,
    problem: flowProblem(flow, question),
    sending: status.sending,
    error: status.error,
    press: (key) => {
      if (status.sending) return;
      const next = flowKey(flow, question, key);
      setHeld(next.flow);
      if (next.answers) send(next.answers);
    },
  };
}

import type { QuestionAnswers, SessionQuestions } from '@moxxy/sdk';
import { RunnerMethod, type QuestionAnswerParams } from './protocol.js';

/**
 * A thin client's side of the session's Questions. The runner counts this
 * client as one surface however many parts of it attach, so it announces only
 * the first attach and the last detach; open questions arrive in the mirrored
 * log like every other record.
 */
export class RemoteQuestions implements SessionQuestions {
  private surfaces = 0;

  constructor(
    private readonly deps: {
      readonly request: (method: string, params: unknown) => Promise<unknown>;
      readonly requireServerProtocol: (minVersion: number, feature: string) => void;
    },
  ) {}

  attachSurface(): () => void {
    this.surfaces += 1;
    if (this.surfaces === 1) this.announce(true);
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.surfaces -= 1;
      if (this.surfaces === 0) this.announce(false);
    };
  }

  async answer(questionId: string, answers: QuestionAnswers): Promise<void> {
    this.deps.requireServerProtocol(26, 'Answering questions');
    const params: QuestionAnswerParams = { questionId, answers };
    await this.deps.request(RunnerMethod.QuestionAnswer, params);
  }

  private announce(question: boolean): void {
    void this.deps.request(RunnerMethod.SetResolver, { question }).catch(() => undefined);
  }
}

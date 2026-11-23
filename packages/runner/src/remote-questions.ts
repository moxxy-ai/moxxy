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
  private envSurfaces = 0;

  constructor(
    private readonly deps: {
      readonly request: (method: string, params: unknown) => Promise<unknown>;
      readonly requireServerProtocol: (minVersion: number, feature: string) => void;
    },
  ) {}

  attachSurface({ envShare = false } = {}): () => void {
    this.surfaces += 1;
    if (envShare) this.envSurfaces += 1;
    if (this.surfaces === 1 || (envShare && this.envSurfaces === 1)) this.announce(true);
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.surfaces -= 1;
      if (envShare) this.envSurfaces -= 1;
      if (this.surfaces === 0 || (envShare && this.envSurfaces === 0)) this.announce(this.surfaces > 0);
    };
  }

  async answer(questionId: string, answers: QuestionAnswers): Promise<void> {
    this.deps.requireServerProtocol(26, 'Answering questions');
    const params: QuestionAnswerParams = { questionId, answers };
    await this.deps.request(RunnerMethod.QuestionAnswer, params);
  }

  async shareEnv(questionId: string, value: string | null): Promise<void> {
    this.deps.requireServerProtocol(35, 'Env Share');
    await this.deps.request(RunnerMethod.QuestionShareEnv, { questionId, value });
  }

  private announce(question: boolean): void {
    void this.deps.request(RunnerMethod.SetResolver, { question, envShare: this.envSurfaces > 0 }).catch(() => undefined);
  }
}

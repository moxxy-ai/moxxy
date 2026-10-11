import type { AgentStepEvent, AgentStepRequest } from '@moxxy/sdk';
import { FakeProvider } from './fake-provider.js';

export type AgentScript = (req: AgentStepRequest) => AsyncIterable<AgentStepEvent>;

/**
 * A provider whose turns are done by a scripted "vendor agent" (an agent
 * connection). The agent is the external boundary, so it is what tests script;
 * every request it got is kept in `steps`.
 */
export class FakeAgentProvider extends FakeProvider {
  readonly steps: AgentStepRequest[] = [];
  constructor(
    private readonly agentScript: AgentScript,
    name = 'fake-agent',
  ) {
    super({ name, script: [] });
  }
  agentStep(req: AgentStepRequest): AsyncIterable<AgentStepEvent> {
    this.steps.push(req);
    return this.agentScript(req);
  }
}

import type { AgentOwnModes, AgentStepEvent, AgentStepRequest, AgentTurnStart } from '@moxxy/sdk';
import { FakeProvider } from './fake-provider.js';

export type AgentScript = (req: AgentStepRequest) => AsyncIterable<AgentStepEvent>;

export interface FakeAgentOptions {
  /** The plan and goal the scripted agent keeps itself, as Claude and Codex do. */
  readonly agentOwns?: AgentOwnModes;
}

/**
 * A provider whose turns are done by a scripted "vendor agent" (an agent
 * connection). The agent is the external boundary, so it is what tests script;
 * every request it got is kept in `steps`.
 */
export class FakeAgentProvider extends FakeProvider {
  readonly steps: AgentStepRequest[] = [];
  readonly agentOwns?: AgentOwnModes;
  constructor(
    private readonly agentScript: AgentScript,
    name = 'fake-agent',
    opts: FakeAgentOptions = {},
  ) {
    super({ name, script: [] });
    if (opts.agentOwns) this.agentOwns = opts.agentOwns;
  }
  private readonly agentTurnListeners = new Set<(start: AgentTurnStart) => void>();
  agentStep(req: AgentStepRequest): AsyncIterable<AgentStepEvent> {
    this.steps.push(req);
    return this.agentScript(req);
  }
  onAgentTurn(listener: (start: AgentTurnStart) => void): () => void {
    this.agentTurnListeners.add(listener);
    return () => this.agentTurnListeners.delete(listener);
  }
  /** The scripted agent starts a turn by itself in the conversation `sessionId`. */
  startAgentTurn(sessionId: string, name: string): void {
    for (const listener of [...this.agentTurnListeners]) listener({ sessionId, name });
  }
}

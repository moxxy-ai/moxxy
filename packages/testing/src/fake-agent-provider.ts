import type { AgentActivity, AgentOwnModes, AgentStepEvent, AgentStepRequest, AgentTurnStart } from '@moxxy/sdk';
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
  /** The scripted agent starts a turn by itself in the conversation `sessionId`, after the background work `workId` ended. */
  startAgentTurn(sessionId: string, name: string, workId?: string): void {
    for (const listener of [...this.agentTurnListeners]) listener({ sessionId, name, ...(workId ? { workId } : {}) });
  }

  private readonly activityListeners = new Set<(activity: AgentActivity) => void>();
  onAgentActivity(listener: (activity: AgentActivity) => void): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }
  /** The scripted agent's background work does something while no turn runs. */
  reportActivity(sessionId: string, events: ReadonlyArray<AgentStepEvent>): void {
    for (const listener of [...this.activityListeners]) listener({ sessionId, events });
  }

  /** Ids of the background work the scripted agent runs now; Stop takes one out. */
  readonly running = new Set<string>();
  /** Every Stop asked of the agent, in order. */
  readonly stopped: Array<{ readonly sessionId: string; readonly workId: string }> = [];
  async stopBackgroundWork(sessionId: string, workId: string): Promise<boolean> {
    this.stopped.push({ sessionId, workId });
    return this.running.delete(workId);
  }
}

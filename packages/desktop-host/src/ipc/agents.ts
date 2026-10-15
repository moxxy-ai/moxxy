/**
 * The CLIs behind the agent connections: check them now, or install / update
 * one on this computer (`./agent-cli`). Progress reaches every window as
 * `agents.progress`; the new state comes back in each runner's info.
 */
import type { RunnerPool } from '../runner-pool';
import { checkAgentClis, runAgentCli, type AgentCliRunner } from '../agent-cli';
import { broadcastHostEvent } from '../event-bus';
import { handle } from './shared';

function runners(pool: RunnerPool): AgentCliRunner[] {
  return pool.list().flatMap(({ supervisor }) => {
    const remote = supervisor.remote();
    return remote ? [remote] : [];
  });
}

export function registerAgentsHandlers(pool: RunnerPool): void {
  handle('agents.check', async () => {
    await checkAgentClis(runners(pool));
  });
  handle('agents.run', async ({ provider, action }) =>
    runAgentCli(provider, action, {
      runners: () => runners(pool),
      emit: (progress) => broadcastHostEvent('agents.progress', progress),
    }),
  );
}

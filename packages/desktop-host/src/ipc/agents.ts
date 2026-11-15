/**
 * The CLIs behind the agent connections: check them now, or install / update
 * one on this computer (`./agent-cli`). Progress reaches every window as
 * `agents.progress`; the new state comes back in each runner's info.
 */
import { app } from 'electron';
import type { RunnerPool } from '../runner-pool';
import { agentCliRunners, checkAgentClis, runAgentCli } from '../agent-cli';
import { broadcastHostEvent } from '../event-bus';
import { managedNodeBinDir } from '../node-manager';
import { handle } from './shared';


export function registerAgentsHandlers(pool: RunnerPool): void {
  handle('agents.check', async () => {
    await checkAgentClis(agentCliRunners(pool));
  });
  handle('agents.run', async ({ provider, action }) =>
    runAgentCli(provider, action, {
      runners: () => agentCliRunners(pool),
      emit: (progress) => broadcastHostEvent('agents.progress', progress),
      // The desktop's own Node sits first on its PATH; an agent's update must reach the npm that installed it.
      hostPathDirs: [managedNodeBinDir(app.getPath('userData'))].filter((dir): dir is string => dir !== null),
    }),
  );
}

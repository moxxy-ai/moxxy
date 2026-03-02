import { TUI, ProcessTerminal } from '@mariozechner/pi-tui';
import { App } from './app.js';
import { parseFlags } from '../commands/auth.js';
import { isInteractive, pickAgent } from '../ui.js';

export async function startTui(client, args) {
  const flags = parseFlags(args);
  let agentId = flags.agent || flags.id;
  const debug = !!flags.debug;

  if (!agentId) {
    try {
      const agents = await client.listAgents();
      if (!agents || agents.length === 0) {
        console.error('No agents found. Create one first: moxxy agent create');
        process.exitCode = 1;
        return;
      }
      if (agents.length === 1) {
        agentId = agents[0].id;
        console.log(`Auto-selected agent: ${agentId.slice(0, 12)}`);
      } else if (isInteractive()) {
        agentId = await pickAgent(client, 'Select agent for chat');
      } else {
        console.error('Multiple agents found. Specify one: moxxy tui --agent <id>');
        process.exitCode = 1;
        return;
      }
    } catch (err) {
      if (err.isGatewayDown) {
        console.log(err.message);
      } else {
        console.error(`Failed to list agents: ${err.message}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const app = new App(tui, client, agentId, { debug });

  // Handle terminal resize
  process.stdout.on('resize', () => {
    app._updateLayout();
    tui.requestRender(true); // force full re-render on resize
  });

  await app.start();
}

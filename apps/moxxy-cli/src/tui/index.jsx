import React from 'react';
import { render } from 'ink';
import { App } from './app.jsx';
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
        agentId = agents[0].name;
        console.log(`Auto-selected agent: ${agentId}`);
      } else if (isInteractive()) {
        agentId = await pickAgent(client, 'Select agent for chat');
      } else {
        console.error('Multiple agents found. Specify one: moxxy tui --agent <name>');
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

  const instance = render(
    <App
      client={client}
      agentId={agentId}
      debug={debug}
      onExit={() => {
        instance.unmount();
        process.exit(0);
      }}
    />,
    { exitOnCtrlC: false }
  );

  await instance.waitUntilExit();
}

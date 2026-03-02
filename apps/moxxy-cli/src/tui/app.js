import { Box, Text, useApp } from 'ink';
import { useCallback } from 'react';
import { h, COLORS, shortId } from './helpers.js';
import { useTerminal } from './use-terminal.js';
import { useAgent } from './use-agent.js';
import { useEvents } from './use-events.js';
import { ChatPanel } from './chat-panel.js';
import { InfoPanel } from './info-panel.js';
import { InputBar } from './input-bar.js';
import { SLASH_COMMANDS } from './slash-commands.js';

export function App({ client, agentId }) {
  const { exit } = useApp();
  const { columns, rows } = useTerminal();
  const { agent, loading, error: agentError, startRun, stopAgent } = useAgent(client, agentId);
  const { messages, stats, connected, addUserMessage, addSystemMessage, clearMessages } = useEvents(client, agent?.id);

  const handleSubmit = useCallback(async (task) => {
    if (task === '/quit' || task === '/exit') { exit(); return; }
    if (task === '/stop') { await stopAgent(); return; }
    if (task === '/clear') { clearMessages(); return; }
    if (task === '/help') {
      addSystemMessage(
        'Commands: ' + SLASH_COMMANDS.map(c => c.name).join(', ')
      );
      return;
    }
    if (task === '/status') {
      const status = agent
        ? `Agent ${shortId(agent.id)}: ${agent.status} | Provider: ${agent.provider_id} | Model: ${agent.model_id} | SSE: ${connected ? 'connected' : 'disconnected'}`
        : 'No agent connected';
      addSystemMessage(status);
      return;
    }
    if (task === '/model') {
      const info = agent
        ? `Model: ${agent.model_id} via ${agent.provider_id}`
        : 'No agent connected';
      addSystemMessage(info);
      return;
    }

    addUserMessage(task);
    await startRun(task);
  }, [addUserMessage, addSystemMessage, clearMessages, startRun, stopAgent, exit, agent, connected]);

  const chatHeight = Math.max(5, rows - 5);

  if (loading) {
    return h(Box, { flexDirection: 'column', height: rows, justifyContent: 'center', alignItems: 'center' },
      h(Text, { color: COLORS.accent }, 'Loading agent...'),
    );
  }

  if (agentError && !agent) {
    return h(Box, { flexDirection: 'column', height: rows, justifyContent: 'center', alignItems: 'center' },
      h(Text, { color: COLORS.error }, `Error: ${agentError}`),
      h(Text, { color: COLORS.dim }, 'Press Ctrl+C to exit'),
    );
  }

  return h(Box, { flexDirection: 'column', height: rows, width: columns },
    h(Box, { flexGrow: 1 },
      h(ChatPanel, { messages, height: chatHeight }),
      h(InfoPanel, { agent, stats, connected, height: chatHeight }),
    ),
    h(InputBar, {
      onSubmit: handleSubmit,
      disabled: loading || !agent,
      agentStatus: agent?.status,
    }),
  );
}

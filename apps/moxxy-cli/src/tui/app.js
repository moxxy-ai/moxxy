import { Box, Text, useApp } from 'ink';
import { useState, useCallback } from 'react';
import { h, COLORS } from './helpers.js';
import { useTerminal } from './use-terminal.js';
import { useAgent } from './use-agent.js';
import { useEvents } from './use-events.js';
import { ChatPanel } from './chat-panel.js';
import { InfoPanel } from './info-panel.js';
import { InputBar } from './input-bar.js';

export function App({ client, agentId }) {
  const { exit } = useApp();
  const { columns, rows } = useTerminal();
  const { agent, loading, error: agentError, startRun, stopAgent } = useAgent(client, agentId);
  const { messages, stats, connected, addUserMessage } = useEvents(client, agent?.id);

  const handleSubmit = useCallback(async (task) => {
    if (task === '/quit' || task === '/exit') { exit(); return; }
    if (task === '/stop') { await stopAgent(); return; }

    addUserMessage(task);
    await startRun(task);
  }, [addUserMessage, startRun, stopAgent, exit]);

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

import { Box, Text, useApp, useInput } from 'ink';
import { useCallback } from 'react';
import { h, COLORS, shortId } from './helpers.js';
import { useTerminal } from './use-terminal.js';
import { useAgent } from './use-agent.js';
import { useEvents } from './use-events.js';
import { ChatPanel } from './chat-panel.js';
import { InfoPanel } from './info-panel.js';
import { InputBar } from './input-bar.js';
import { SLASH_COMMANDS } from './slash-commands.js';
import { useTabs } from './use-tabs.js';
import { TabBar } from './tab-bar.js';

function TabSession({ client, agentId, isActive, onSubmit, termRows }) {
  const { agent, loading, error: agentError, startRun, stopAgent } = useAgent(client, agentId);
  const { messages, stats, connected, addUserMessage, addSystemMessage, clearMessages } = useEvents(client, agent?.id);

  const handleSubmit = useCallback(async (task) => {
    if (task === '/quit' || task === '/exit') { onSubmit(task); return; }
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

    // Pass tab commands up to the App
    if (task.startsWith('/tab ') || task === '/close') {
      onSubmit(task);
      return;
    }

    addUserMessage(task);
    await startRun(task);
  }, [addUserMessage, addSystemMessage, clearMessages, startRun, stopAgent, onSubmit, agent, connected]);

  if (!isActive) return null;

  const chatHeight = Math.max(5, termRows - 5);

  if (loading) {
    return h(Box, { flexDirection: 'column', flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
      h(Text, { color: COLORS.accent }, 'Loading agent...'),
    );
  }

  if (agentError && !agent) {
    return h(Box, { flexDirection: 'column', flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
      h(Text, { color: COLORS.error }, `Error: ${agentError}`),
      h(Text, { color: COLORS.dim }, 'Press Ctrl+C to exit'),
    );
  }

  return h(Box, { flexDirection: 'column', flexGrow: 1 },
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

export function App({ client, agentId }) {
  const { exit } = useApp();
  const { columns, rows } = useTerminal();
  const { tabs, activeIndex, activeTab, addTab, closeTab, switchTab, switchLeft, switchRight } = useTabs(agentId);

  const handleSubmit = useCallback((task) => {
    if (task === '/quit' || task === '/exit') { exit(); return; }
    if (task === '/tab new') {
      addTab(agentId);
      return;
    }
    if (task === '/tab close' || task === '/close') {
      closeTab(activeIndex);
      return;
    }
    if (task === '/tab list') {
      return;
    }
  }, [exit, addTab, closeTab, activeIndex, agentId]);

  useInput((input, key) => {
    if (key.ctrl && input >= '1' && input <= '9') {
      const idx = parseInt(input, 10) - 1;
      if (idx < tabs.length) {
        switchTab(idx);
      }
    }
  });

  return h(Box, { flexDirection: 'column', height: rows, width: columns },
    tabs.length > 1 ? h(TabBar, { tabs, activeIndex }) : null,
    ...tabs.map((tab, i) =>
      h(TabSession, {
        key: tab.id,
        client,
        agentId: tab.agentId,
        isActive: i === activeIndex,
        onSubmit: handleSubmit,
        termRows: rows,
      })
    ),
  );
}

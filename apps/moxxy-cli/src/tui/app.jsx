import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, useInput, useApp, useStdout } from 'ink';
import { Header } from './components/header.jsx';
import { ChatPanel } from './components/chat-panel.jsx';
import { InputArea } from './components/input-area.jsx';
import { ActionPicker } from './components/action-picker.jsx';
import { ModelPicker } from './components/model-picker.jsx';
import { EventsHandler } from './events-handler.js';
import { useEventsStore } from './store.js';
import { useCommandHandler } from './hooks/use-command-handler.js';
import {
  buildModelPickerEntries,
  clampPickerScroll,
  findFirstSelectableIndex,
  movePickerSelection,
} from './model-picker.js';

const SCROLL_LINES = 3;

function useTerminalHeight() {
  const { stdout } = useStdout();
  const [height, setHeight] = useState(stdout?.rows || process.stdout.rows || 24);

  useEffect(() => {
    const target = stdout || process.stdout;
    const onResize = () => setHeight(target.rows || 24);
    target.on('resize', onResize);
    return () => target.off('resize', onResize);
  }, [stdout]);

  return height;
}

export function App({ client, agentId, debug, onExit }) {
  const { exit } = useApp();
  const termHeight = useTerminalHeight();
  const handlerRef = useRef(null);
  if (!handlerRef.current) {
    handlerRef.current = new EventsHandler(client, agentId, { debug });
  }
  const eventsHandler = handlerRef.current;

  const [agent, setAgent] = useState(null);
  const [contextWindow, setContextWindow] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [actionPicker, setActionPicker] = useState(null);
  const [modelPicker, setModelPicker] = useState(null);
  const modelMetaKeyRef = useRef(null);
  const pollRef = useRef(null);
  const agentRef = useRef(null);
  const handleSubmitRef = useRef(null);

  agentRef.current = agent;

  const snapshot = useEventsStore(eventsHandler);
  const currentCustomSelection = useCallback((models) => {
    const currentAgent = agentRef.current;
    if (!currentAgent?.provider_id || !currentAgent?.model_id) return null;
    const hasExactMatch = (models || []).some(model =>
      model.provider_id === currentAgent.provider_id && model.model_id === currentAgent.model_id
    );
    if (hasExactMatch) return null;
    return {
      provider_id: currentAgent.provider_id,
      model_id: currentAgent.model_id,
    };
  }, []);

  const pickerVisibleRows = Math.max(4, Math.min(10, termHeight - 18));

  const openActionPicker = useCallback((title, items) => {
    if (!items || items.length === 0) return;
    setActionPicker({
      title,
      items,
      selected: 0,
      scroll: 0,
      status: null,
    });
  }, []);

  // Auto-scroll to bottom when new messages arrive
  const prevMsgVersion = useRef(snapshot.messageVersion);
  useEffect(() => {
    if (snapshot.messageVersion !== prevMsgVersion.current) {
      prevMsgVersion.current = snapshot.messageVersion;
      setScrollOffset(0);
    }
  }, [snapshot.messageVersion]);

  const scrollUp = useCallback(() => {
    setScrollOffset(prev => prev + SCROLL_LINES);
  }, []);

  const scrollDown = useCallback(() => {
    setScrollOffset(prev => Math.max(0, prev - SCROLL_LINES));
  }, []);

  const pageUp = useCallback(() => {
    setScrollOffset(prev => prev + Math.max(5, termHeight - 10));
  }, [termHeight]);

  const pageDown = useCallback(() => {
    setScrollOffset(prev => Math.max(0, prev - Math.max(5, termHeight - 10)));
  }, [termHeight]);

  const handleExit = useCallback(() => {
    eventsHandler.disconnect();
    if (pollRef.current) clearInterval(pollRef.current);
    if (onExit) onExit();
    else exit();
  }, [eventsHandler, onExit, exit]);

  const handleStop = useCallback(async () => {
    const a = agentRef.current;
    if (a && a.status === 'running') {
      try {
        await client.stopAgent(a.name);
        setAgent(prev => ({ ...prev, status: 'idle' }));
        eventsHandler._stopThinking();
        eventsHandler.addSystemMessage('Agent stopped.');
      } catch (err) {
        eventsHandler.addSystemMessage(`Error: ${err.message}`);
      }
    }
  }, [client, eventsHandler]);

  const syncContextWindow = useCallback(async (force = false) => {
    const a = agentRef.current;
    if (!a?.provider_id || !a?.model_id) return;
    const key = `${a.provider_id}/${a.model_id}`;
    if (!force && modelMetaKeyRef.current === key) return;
    try {
      const models = await client.listModels(a.provider_id);
      const selected = (models || []).find(m => m.model_id === a.model_id);
      const cw = readContextWindow(selected?.metadata);
      setContextWindow(cw);
      modelMetaKeyRef.current = key;
    } catch {
      setContextWindow(0);
      modelMetaKeyRef.current = null;
    }
  }, [client]);

  const handleAgentUpdate = useCallback((patch) => {
    setAgent(prev => prev ? { ...prev, ...patch } : prev);
  }, []);

  const applyModelSelection = useCallback(async (providerId, modelId) => {
    await client.updateAgent(agentId, {
      provider_id: providerId,
      model_id: modelId,
    });
    handleAgentUpdate({ provider_id: providerId, model_id: modelId });
    syncContextWindow(true);
    eventsHandler.addSystemMessage(`Switched to ${providerId}/${modelId}.`);
  }, [client, agentId, handleAgentUpdate, syncContextWindow, eventsHandler]);

  const refreshModelPicker = useCallback((prev, query) => {
    const entries = buildModelPickerEntries(
      prev.providers,
      prev.models,
      query,
      currentCustomSelection(prev.models)
    );
    const selected = findFirstSelectableIndex(entries);
    return {
      ...prev,
      mode: 'browse',
      query,
      entries,
      selected,
      scroll: clampPickerScroll(selected, 0, pickerVisibleRows),
      status: entries.length === 0 ? 'No models available.' : null,
    };
  }, [currentCustomSelection, pickerVisibleRows]);

  const openModelPicker = useCallback(async () => {
    try {
      const providers = await client.listProviders();
      if (!providers || providers.length === 0) {
        eventsHandler.addSystemMessage('No providers found.');
        return;
      }

      const modelGroups = await Promise.all(
        providers.map(async (provider) => {
          try {
            const models = await client.listModels(provider.id);
            return { provider, models: models || [] };
          } catch {
            return { provider, models: [] };
          }
        })
      );

      const models = modelGroups.flatMap(({ provider, models }) =>
        models.map((model) => ({
          provider_id: provider.id,
          provider_name: provider.display_name || provider.id,
          model_id: model.model_id,
          model_name: model.display_name || model.model_id,
          deployment: readDeployment(provider.id, model),
          is_current:
            provider.id === agentRef.current?.provider_id
            && model.model_id === agentRef.current?.model_id,
          metadata: model.metadata,
        }))
      );

      const entries = buildModelPickerEntries(
        providers,
        models,
        '',
        currentCustomSelection(models)
      );
      const selected = findFirstSelectableIndex(entries);

      setModelPicker({
        mode: 'browse',
        providers,
        models,
        query: '',
        focus: 'list',
        entries,
        selected,
        scroll: clampPickerScroll(selected, 0, pickerVisibleRows),
        status: entries.length === 0 ? 'No models available.' : null,
      });
    } catch (err) {
      eventsHandler.addSystemMessage(`Error: ${err.message}`);
    }
  }, [client, currentCustomSelection, eventsHandler, pickerVisibleRows]);

  const { handleSubmit } = useCommandHandler({
    client,
    agent,
    agentId,
    eventsHandler,
    onStop: handleStop,
    onExit: handleExit,
    onAgentUpdate: handleAgentUpdate,
    onContextSync: () => syncContextWindow(true),
    onOpenModelPicker: openModelPicker,
    onOpenVaultPicker: async () => openActionPicker('Vault', [
      { label: '/vault list', description: 'List vault secrets', command: '/vault list' },
      { label: '/vault set', description: 'Set a vault secret', command: '/vault set' },
      { label: '/vault remove', description: 'Remove a vault secret', command: '/vault remove' },
    ]),
    onOpenMcpPicker: async () => openActionPicker('MCP', [
      { label: '/mcp list', description: 'List MCP servers and tools', command: '/mcp list' },
      { label: '/mcp add', description: 'Add an MCP server', command: '/mcp add' },
      { label: '/mcp remove', description: 'Remove an MCP server', command: '/mcp remove' },
      { label: '/mcp test', description: 'Test MCP server connection', command: '/mcp test' },
    ]),
    onOpenTemplatePicker: async () => openActionPicker('Template', [
      { label: '/template list', description: 'List available templates', command: '/template list' },
      { label: '/template assign', description: 'Assign a template to the agent', command: '/template assign' },
      { label: '/template clear', description: 'Clear the current template', command: '/template clear' },
    ]),
  });
  handleSubmitRef.current = handleSubmit;

  // Load agent + connect SSE on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const agentData = await client.getAgent(agentId);
        if (!cancelled) setAgent(agentData);
      } catch (err) {
        if (err.isGatewayDown) {
          eventsHandler.addSystemMessage(err.message);
        } else {
          eventsHandler.addSystemMessage(`Error loading agent: ${err.message}`);
        }
      }

      await eventsHandler.loadHistory(client, agentId);
      eventsHandler.connect();
    }

    init();

    return () => {
      cancelled = true;
      eventsHandler.disconnect();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [client, agentId, eventsHandler]);

  // Sync context window when agent loads/changes
  useEffect(() => {
    if (agent) syncContextWindow();
  }, [agent?.provider_id, agent?.model_id, syncContextWindow]);

  // Poll agent status
  useEffect(() => {
    if (!agent || agent.status !== 'running') return;

    pollRef.current = setInterval(async () => {
      try {
        const updated = await client.getAgent(agentId);
        setAgent(updated);
        const key = `${updated.provider_id}/${updated.model_id}`;
        if (modelMetaKeyRef.current !== key) {
          syncContextWindow(true);
        }
      } catch { /* ignore polling errors */ }
    }, 5000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [agent?.status, client, agentId, syncContextWindow]);

  // Global keybindings
  useInput(async (input, key) => {
    if (actionPicker) {
      if (key.escape) {
        setActionPicker(null);
        return;
      }

      if (key.return) {
        const item = actionPicker.items[actionPicker.selected];
        if (!item) return;
        setActionPicker(null);
        await handleSubmitRef.current(item.command);
        return;
      }

      if (key.upArrow) {
        setActionPicker(prev => {
          if (!prev) return prev;
          const selected = Math.max(0, movePickerSelection(prev.items, prev.selected, -1));
          return {
            ...prev,
            selected,
            scroll: clampPickerScroll(selected, prev.scroll, pickerVisibleRows),
          };
        });
        return;
      }

      if (key.downArrow) {
        setActionPicker(prev => {
          if (!prev) return prev;
          const selected = Math.min(prev.items.length - 1, movePickerSelection(prev.items, prev.selected, 1));
          return {
            ...prev,
            selected,
            scroll: clampPickerScroll(selected, prev.scroll, pickerVisibleRows),
          };
        });
        return;
      }

      if (key.pageUp) {
        setActionPicker(prev => {
          if (!prev) return prev;
          const selected = Math.max(0, prev.selected - pickerVisibleRows);
          return {
            ...prev,
            selected,
            scroll: clampPickerScroll(selected, prev.scroll, pickerVisibleRows),
          };
        });
        return;
      }

      if (key.pageDown) {
        setActionPicker(prev => {
          if (!prev) return prev;
          const selected = Math.min(prev.items.length - 1, prev.selected + pickerVisibleRows);
          return {
            ...prev,
            selected,
            scroll: clampPickerScroll(selected, prev.scroll, pickerVisibleRows),
          };
        });
        return;
      }

      return;
    }

    if (modelPicker) {
      if (modelPicker.mode === 'browse') {
        if (key.escape) {
          setModelPicker(null);
          return;
        }

        if (key.return) {
          const entry = modelPicker.entries[modelPicker.selected];
          if (!entry || entry.type === 'section') return;

          if (entry.type === 'custom') {
            setModelPicker(prev => prev ? {
              ...prev,
              mode: 'custom',
              providerId: entry.provider_id,
              providerName: entry.provider_name,
              value: entry.current_model_id || '',
              status: null,
            } : prev);
            return;
          }

          setModelPicker(null);
          try {
            await applyModelSelection(entry.provider_id, entry.model_id);
          } catch (err) {
            eventsHandler.addSystemMessage(`Error: ${err.message}`);
          }
          return;
        }

        if (key.upArrow) {
          setModelPicker(prev => {
            if (!prev) return prev;
            const selected = movePickerSelection(prev.entries, prev.selected, -1);
            return {
              ...prev,
              selected,
              focus: 'list',
              scroll: clampPickerScroll(selected, prev.scroll, pickerVisibleRows),
            };
          });
          return;
        }

        if (key.downArrow) {
          setModelPicker(prev => {
            if (!prev) return prev;
            const selected = movePickerSelection(prev.entries, prev.selected, 1);
            return {
              ...prev,
              selected,
              focus: 'list',
              scroll: clampPickerScroll(selected, prev.scroll, pickerVisibleRows),
            };
          });
          return;
        }

        if (key.pageUp) {
          setModelPicker(prev => {
            if (!prev) return prev;
            let selected = prev.selected;
            for (let i = 0; i < pickerVisibleRows; i++) {
              selected = movePickerSelection(prev.entries, selected, -1);
            }
            return {
              ...prev,
              selected,
              focus: 'list',
              scroll: clampPickerScroll(selected, prev.scroll, pickerVisibleRows),
            };
          });
          return;
        }

        if (key.pageDown) {
          setModelPicker(prev => {
            if (!prev) return prev;
            let selected = prev.selected;
            for (let i = 0; i < pickerVisibleRows; i++) {
              selected = movePickerSelection(prev.entries, selected, 1);
            }
            return {
              ...prev,
              selected,
              focus: 'list',
              scroll: clampPickerScroll(selected, prev.scroll, pickerVisibleRows),
            };
          });
          return;
        }

        if (key.tab) {
          setModelPicker(prev => prev ? {
            ...prev,
            focus: prev.focus === 'search' ? 'list' : 'search',
          } : prev);
          return;
        }

        if ((key.backspace || key.delete) && modelPicker.focus === 'search') {
          setModelPicker(prev => prev ? refreshModelPicker(prev, prev.query.slice(0, -1)) : prev);
          return;
        }

        if (!key.ctrl && !key.meta && !key.escape && input && modelPicker.focus === 'search') {
          setModelPicker(prev => prev ? refreshModelPicker(prev, prev.query + input) : prev);
          return;
        }

        return;
      }

      if (modelPicker.mode === 'custom') {
        if (key.escape) {
          setModelPicker(prev => prev ? ({
            ...prev,
            mode: 'browse',
            status: null,
          }) : prev);
          return;
        }

        if (key.return) {
          const value = modelPicker.value.trim();
          if (!value) {
            setModelPicker(prev => prev ? ({ ...prev, status: 'Custom model ID cannot be empty.' }) : prev);
            return;
          }

          const providerId = modelPicker.providerId;
          setModelPicker(null);
          try {
            await applyModelSelection(providerId, value);
          } catch (err) {
            eventsHandler.addSystemMessage(`Error: ${err.message}`);
          }
          return;
        }

        if (key.backspace || key.delete) {
          setModelPicker(prev => prev ? ({
            ...prev,
            value: prev.value.slice(0, -1),
            status: null,
          }) : prev);
          return;
        }

        if (!key.ctrl && !key.meta && !key.escape && input && !key.upArrow && !key.downArrow) {
          setModelPicker(prev => prev ? ({
            ...prev,
            value: prev.value + input,
            status: null,
          }) : prev);
          return;
        }

        return;
      }
    }

    if (key.ctrl && input === 'x') {
      handleStop();
    }
    if (key.ctrl && input === 't') {
      setToolsExpanded(prev => !prev);
    }
    // Shift+Up / Shift+Down for scroll
    if (key.shift && key.upArrow) {
      scrollUp();
    }
    if (key.shift && key.downArrow) {
      scrollDown();
    }
    if (key.pageUp) {
      pageUp();
    }
    if (key.pageDown) {
      pageDown();
    }
  });

  return (
    <Box flexDirection="column" width="100%">
      <Header agent={agent} />
      <ChatPanel
        messages={snapshot.messages}
        thinking={snapshot.thinking}
        agentName={agent?.name}
        scrollOffset={scrollOffset}
        toolsExpanded={toolsExpanded}
        termHeight={termHeight}
      />
      {actionPicker && (
        <ActionPicker picker={actionPicker} termHeight={termHeight} />
      )}
      {modelPicker && (
        <ModelPicker picker={modelPicker} termHeight={termHeight} />
      )}
      <InputArea
        onSubmit={handleSubmit}
        onExit={handleExit}
        onStop={handleStop}
        pendingAsk={snapshot.pendingAsk}
        agent={agent}
        disabled={Boolean(actionPicker || modelPicker)}
      />
    </Box>
  );
}

function readContextWindow(metadata) {
  if (!metadata || typeof metadata !== 'object') return 0;
  const candidates = [
    metadata.context_window,
    metadata.contextWindow,
    metadata.max_context_tokens,
    metadata.max_input_tokens,
    metadata.input_token_limit,
  ];
  for (const value of candidates) {
    const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

function readDeployment(providerId, model) {
  const direct = typeof model?.deployment === 'string' ? model.deployment.trim().toLowerCase() : '';
  if (direct) return direct;

  const metadataDeployment = typeof model?.metadata?.deployment === 'string'
    ? model.metadata.deployment.trim().toLowerCase()
    : '';
  if (metadataDeployment) return metadataDeployment;

  if (providerId === 'ollama') {
    const id = String(model?.model_id || '').toLowerCase();
    return id.includes(':cloud') || id.includes('-cloud') ? 'cloud' : 'local';
  }

  return null;
}

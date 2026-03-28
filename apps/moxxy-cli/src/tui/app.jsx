import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, useInput, useApp, useStdout } from 'ink';
import { Header } from './components/header.jsx';
import { ChatPanel } from './components/chat-panel.jsx';
import { InputArea } from './components/input-area.jsx';
import { EventsHandler } from './events-handler.js';
import { useEventsStore } from './store.js';
import { useCommandHandler } from './hooks/use-command-handler.js';

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
  const modelMetaKeyRef = useRef(null);
  const pollRef = useRef(null);
  const agentRef = useRef(null);

  agentRef.current = agent;

  const snapshot = useEventsStore(eventsHandler);

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

  const { handleSubmit } = useCommandHandler({
    client,
    agent,
    agentId,
    eventsHandler,
    onStop: handleStop,
    onExit: handleExit,
    onAgentUpdate: handleAgentUpdate,
    onContextSync: () => syncContextWindow(true),
  });

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
  useInput((input, key) => {
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
      <InputArea
        onSubmit={handleSubmit}
        onExit={handleExit}
        onStop={handleStop}
        pendingAsk={snapshot.pendingAsk}
        agent={agent}
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

import React, { useState, useEffect } from 'react';
import type { TabId } from './types';
import { useApi } from './hooks/useApi';
import { useAgents } from './hooks/useAgents';
import { useLogs } from './hooks/useLogs';
import { usePolling } from './hooks/usePolling';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { SwarmOverview } from './components/SwarmOverview';
import { MemoryViewer } from './components/MemoryViewer';
import { SkillsManager } from './components/SkillsManager';
import { ChannelsPanel } from './components/ChannelsPanel';
import { SchedulesPanel } from './components/SchedulesPanel';
import { WebhooksPanel } from './components/WebhooksPanel';
import { McpServersPanel } from './components/McpServersPanel';
import { VaultPanel } from './components/VaultPanel';
import { AccessTokensPanel } from './components/AccessTokensPanel';
import { ConfigPanel } from './components/ConfigPanel';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('Overview');

  const { apiBase, setApiBase } = useApi();
  const agentState = useAgents(apiBase);
  const { logs, logsEndRef } = useLogs(apiBase);
  const polling = usePolling(apiBase, agentState.activeAgent);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, activeTab, logsEndRef]);

  useEffect(() => {
    polling.chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [polling.chatHistory, polling.streamMessages, polling.optimisticUserMsg, polling.isTyping, activeTab, polling.chatEndRef]);

  useEffect(() => {
    if (!agentState.activeAgent && activeTab !== 'Overview' && activeTab !== 'Config') {
      setActiveTab('Overview');
    }
  }, [activeTab, agentState.activeAgent]);

  const parseLogLine = (line: string): React.ReactNode => {
    const clean = line.replace(/\\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\[[0-9;]+m/g, '');
    if (clean.includes('INFO')) return <><span className="text-sky-600 font-bold">INFO</span> {clean.replace('INFO', '')}</>;
    if (clean.includes('WARN')) return <><span className="text-amber-400 font-bold">WARN</span> {clean.replace('WARN', '')}</>;
    if (clean.includes('ERROR')) return <><span className="text-red-400 font-bold">ERROR</span> {clean.replace('ERROR', '')}</>;
    if (clean.includes('OK')) return <><span className="text-emerald-400 font-bold">OK</span> {clean.replace('OK', '')}</>;
    return clean;
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'Interface':
        return (
          <ChatPanel
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            chatHistory={polling.chatHistory}
            streamMessages={polling.streamMessages}
            optimisticUserMsg={polling.optimisticUserMsg}
            isTyping={polling.isTyping}
            chatInput={polling.chatInput}
            setChatInput={polling.setChatInput}
            handleChatSubmit={polling.handleChatSubmit}
            chatEndRef={polling.chatEndRef}
            logs={logs}
            logsEndRef={logsEndRef}
            parseLogLine={parseLogLine}
          />
        );
      case 'Overview':
        return (
          <SwarmOverview
            apiBase={apiBase}
            agents={agentState.agents}
            setAgents={agentState.setAgents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            setChatHistory={polling.setChatHistory}
            setStreamMessages={polling.setStreamMessages}
            setOptimisticUserMsg={polling.setOptimisticUserMsg}
            sessionCursorRef={polling.sessionCursorRef}
            seenIdsRef={polling.seenIdsRef}
          />
        );
      case 'Memory':
        return (
          <MemoryViewer
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            stm={agentState.stm}
          />
        );
      case 'Skills':
        return (
          <SkillsManager
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            skills={agentState.skills}
          />
        );
      case 'Channels':
        return (
          <ChannelsPanel
            apiBase={apiBase}
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            channels={agentState.channels}
            setChannels={agentState.setChannels}
            sttEnabled={agentState.sttEnabled}
            setSttEnabled={agentState.setSttEnabled}
          />
        );
      case 'Schedules':
        return (
          <SchedulesPanel
            apiBase={apiBase}
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            schedules={agentState.schedules}
            setSchedules={agentState.setSchedules}
          />
        );
      case 'Webhooks':
        return (
          <WebhooksPanel
            apiBase={apiBase}
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            webhooks={agentState.webhooks}
            setWebhooks={agentState.setWebhooks}
          />
        );
      case 'MCPServers':
        return (
          <McpServersPanel
            apiBase={apiBase}
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            mcpServers={agentState.mcpServers}
            setMcpServers={agentState.setMcpServers}
          />
        );
      case 'Vault':
        return (
          <VaultPanel
            apiBase={apiBase}
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            vaultKeys={agentState.vaultKeys}
            setVaultKeys={agentState.setVaultKeys}
          />
        );
      case 'AccessTokens':
        return (
          <AccessTokensPanel
            apiBase={apiBase}
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
            apiTokens={agentState.apiTokens}
            setApiTokens={agentState.setApiTokens}
          />
        );
      case 'Config':
        return (
          <ConfigPanel
            apiBase={apiBase}
            setApiBase={setApiBase}
            agents={agentState.agents}
            activeAgent={agentState.activeAgent}
            setActiveAgent={agentState.setActiveAgent}
          />
        );
      default:
        return <div className="panel-page"><div className="panel-shell">Module offline.</div></div>;
    }
  };

  return (
    <div className="app-shell">
      <Header
        agents={agentState.agents}
        activeAgent={agentState.activeAgent}
        setActiveAgent={agentState.setActiveAgent}
      />
      <div className="shell-body">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeAgent={agentState.activeAgent}
        />
        <main className="main-canvas">
          <div className="main-canvas-inner scroll-styled">
            {activeTab !== 'Overview' && activeTab !== 'Config' && !agentState.activeAgent ? (
              <div className="panel-page">
                <div className="panel-shell items-start justify-center">
                  <h2 className="text-lg font-semibold text-[#111827] mb-2">Select an Agent First</h2>
                  <p className="text-sm text-[#64748b] mb-4">
                    {agentState.agents.length === 0
                      ? 'Create your first agent in Overview, then continue.'
                      : 'Choose an agent from the header selector to continue.'}
                  </p>
                  <button
                    onClick={() => setActiveTab('Overview')}
                    className="rounded-md border border-[#2563eb] bg-[#2563eb] text-white px-3 py-2 text-xs font-medium hover:bg-[#1d4ed8]"
                  >
                    Open Overview
                  </button>
                </div>
              </div>
            ) : (
              renderContent()
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;

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
  const [activeTab, setActiveTab] = useState<TabId>('Interface');
  const [now, setNow] = useState(new Date());

  const { apiBase, setApiBase } = useApi();
  const agentState = useAgents(apiBase);
  const { logs, logsEndRef } = useLogs(apiBase);
  const polling = usePolling(apiBase, agentState.activeAgent);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, activeTab, logsEndRef]);

  useEffect(() => {
    polling.chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [polling.chatHistory, polling.streamMessages, polling.optimisticUserMsg, polling.isTyping, activeTab, polling.chatEndRef]);

  const parseLogLine = (line: string): React.ReactNode => {
    const clean = line.replace(/\\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\[[0-9;]+m/g, '');
    if (clean.includes('INFO')) return <><span className="text-[#0088ff] font-bold">INFO</span> {clean.replace('INFO', '')}</>;
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
        return <div>Module Offline</div>;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0b101a] text-slate-300 font-sans overflow-hidden">
      <Header now={now} agentCount={agentState.agents.length} />
      <div className="flex-grow flex overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-grow bg-gradient-to-br from-[#121c2d] to-[#0a0f18] relative overflow-hidden">
          <div className="absolute inset-0 p-4 pb-6 h-full overflow-y-auto scroll-styled">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;

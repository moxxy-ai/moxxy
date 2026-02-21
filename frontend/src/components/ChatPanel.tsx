import React from 'react';
import type { ChatMessage, StreamMessage } from '../types';

interface ChatPanelProps {
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  chatHistory: ChatMessage[];
  streamMessages: StreamMessage[];
  optimisticUserMsg: string | null;
  isTyping: boolean;
  chatInput: string;
  setChatInput: (val: string) => void;
  handleChatSubmit: (e: React.FormEvent) => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  logs: string[];
  logsEndRef: React.RefObject<HTMLDivElement | null>;
  parseLogLine: (line: string) => React.ReactNode;
}

export function ChatPanel({
  agents,
  activeAgent,
  setActiveAgent,
  chatHistory,
  streamMessages,
  optimisticUserMsg,
  isTyping,
  chatInput,
  setChatInput,
  handleChatSubmit,
  chatEndRef,
  logs,
  logsEndRef,
  parseLogLine,
}: ChatPanelProps) {
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Top Row */}
      <div className="flex gap-4 h-[62%] shrink-0">
        {/* Panel 01: Swarm Roster */}
        <div className="w-1/4 shrink-0 bg-[#111927]/90 border border-[#1e304f] relative flex flex-col overflow-hidden shadow-2xl backdrop-blur-sm">
          <div className="absolute top-0 left-0 flex">
            <div className="bg-[#00aaff] text-white font-bold text-sm px-3 py-1 flex items-center justify-center min-w-[36px]">01</div>
            <div className="bg-[#17263d] text-[#00aaff] text-[10px] uppercase px-3 py-1 flex items-center tracking-widest border-b border-r border-[#1e304f]">Swarm View</div>
          </div>
          <div className="flex-grow pt-10 p-3 overflow-y-auto scroll-styled">
            <div className="flex flex-col gap-2">
              {agents.length === 0 ? (
                <div className="text-[#64748b] italic text-xs p-2">No active nodes.</div>
              ) : (
                agents.map(agent => (
                  <div
                    key={agent}
                    onClick={() => setActiveAgent(agent)}
                    className={`border p-2.5 rounded-sm flex items-center gap-3 transition cursor-pointer ${
                      activeAgent === agent
                        ? 'border-[#00aaff] bg-[#162a45] shadow-[inset_0_0_10px_rgba(0,170,255,0.15)]'
                        : 'border-[#1e304f] bg-[#0d1522] hover:border-[#385885]'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-sm border flex items-center justify-center font-bold text-xs ${
                      activeAgent === agent
                        ? 'border-[#00aaff] text-[#00aaff] shadow-[0_0_8px_rgba(0,170,255,0.4)] bg-[#0b121f]'
                        : 'border-[#385885] text-slate-400 bg-[#111927]'
                    }`}>
                      {agent.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-grow flex justify-between items-center">
                      <div className={`text-xs font-semibold tracking-wide ${activeAgent === agent ? 'text-white' : 'text-[#cbd5e1]'}`}>{agent}</div>
                      {activeAgent === agent && (
                        <div className="text-[#00aaff] text-[9px] tracking-widest flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00aaff] animate-pulse"></span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Panel 02: Chat Uplink */}
        <div className="flex-grow bg-[#111927]/90 border border-[#1e304f] relative flex flex-col overflow-hidden shadow-2xl backdrop-blur-sm">
          <div className="absolute top-0 left-0 flex">
            <div className="bg-[#00aaff] text-white font-bold text-sm px-3 py-1 flex items-center justify-center min-w-[36px]">02</div>
            <div className="bg-[#17263d] text-[#00aaff] text-[10px] uppercase px-3 py-1 flex items-center tracking-widest border-b border-r border-[#1e304f]">Chat Uplink</div>
          </div>

          <div className="flex-grow pt-10 p-4 flex flex-col relative z-10 w-full h-full overflow-hidden min-h-0">
            <div className="flex-grow bg-[#090d14]/80 border border-[#1e304f] rounded-sm mb-3 p-3 overflow-y-auto scroll-styled flex flex-col gap-3 min-h-0">
              {chatHistory.length === 0 && !optimisticUserMsg && streamMessages.length === 0 && !isTyping && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] text-xs px-3 py-2 leading-relaxed bg-[#1e304f]/40 border border-[#1e304f] text-[#cbd5e1] rounded-tl-sm rounded-tr-sm rounded-br-sm whitespace-pre-wrap">
                    Initiate sequence to begin.
                  </div>
                </div>
              )}
              {chatHistory.map((msg) => (
                <div key={`db-${msg.id}`} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] text-xs px-3 py-2 leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-[#00aaff]/10 border border-[#00aaff]/30 text-[#e2e8f0] rounded-tl-sm rounded-tr-sm rounded-bl-sm'
                      : 'bg-[#1e304f]/40 border border-[#1e304f] text-[#cbd5e1] rounded-tl-sm rounded-tr-sm rounded-br-sm whitespace-pre-wrap'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {optimisticUserMsg && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] text-xs px-3 py-2 leading-relaxed bg-[#00aaff]/10 border border-[#00aaff]/30 text-[#e2e8f0] rounded-tl-sm rounded-tr-sm rounded-bl-sm opacity-50">
                    {optimisticUserMsg}
                  </div>
                </div>
              )}
              {streamMessages.map((msg, idx) => (
                <div key={`stream-${idx}`} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] text-xs px-3 py-2 leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-[#00aaff]/10 border border-[#00aaff]/30 text-[#e2e8f0] rounded-tl-sm rounded-tr-sm rounded-bl-sm'
                      : 'bg-[#1e304f]/40 border border-[#1e304f] text-[#00aaff] rounded-tl-sm rounded-tr-sm rounded-br-sm whitespace-pre-wrap italic tracking-wide'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isTyping && streamMessages.length === 0 && (
                <div className="flex justify-start">
                  <div className="bg-[#1e304f]/40 border border-[#1e304f] text-[#00aaff] px-3 py-2 rounded-sm text-xs flex gap-1 items-center italic tracking-wider">
                    PROCESSING<span className="animate-pulse">_</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleChatSubmit} className="flex gap-2 isolate relative z-10">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                className="flex-grow bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] focus:bg-[#111927] outline-none px-3 py-2 text-xs text-white placeholder-[#475569] font-mono shadow-inner transition-colors"
                placeholder="> Transmit command sequence..."
              />
              <button type="submit" disabled={!activeAgent || isTyping} className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 text-xs font-bold tracking-widest shadow-[0_0_15px_rgba(0,170,255,0.3)] transition-all">
                EXEC
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Bottom Row: Data Log -- full width */}
      <div className="h-[38%] shrink-0">
        <div className="w-full h-full bg-[#111927]/90 border border-[#1e304f] relative flex flex-col overflow-hidden shadow-2xl backdrop-blur-sm">
          <div className="absolute top-0 left-0 flex">
            <div className="bg-[#00aaff] text-white font-bold text-sm px-3 py-1 flex items-center justify-center min-w-[36px]">03</div>
            <div className="bg-[#17263d] text-[#00aaff] text-[10px] uppercase px-3 py-1 flex items-center tracking-widest border-b border-r border-[#1e304f]">Data Log</div>
          </div>
          <div className="flex-grow pt-10 p-4 overflow-hidden relative">
            <div className="h-full w-full font-mono text-[10px] text-[#94a3b8] overflow-y-auto scroll-styled whitespace-pre-wrap leading-tight bg-[#0a101a]/50 p-2 border border-[#1e304f]">
              {logs.length === 0 ? (
                <div className="text-[#475569] italic font-sans pl-2">Awaiting stream...</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="pl-2 mb-0.5 hover:bg-[#1e304f]/30 border-l border-transparent hover:border-[#00aaff] transition pb-[1px]">{parseLogLine(log)}</div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

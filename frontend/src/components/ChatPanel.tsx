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
    <div className="panel-page">
      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-3 min-h-0 h-[66%]">
        <section className="panel-shell">
          <div className="flex items-center justify-between pb-2 border-b border-[#e5e7eb]">
            <h2 className="panel-title">Agents</h2>
            <span className="text-xs text-[#64748b]">{agents.length}</span>
          </div>

          <div className="mt-3 space-y-2 overflow-y-auto scroll-styled min-h-0">
            {agents.length === 0 && (
              <p className="text-xs text-[#64748b]">No agents available.</p>
            )}

            {agents.map(agent => (
              <button
                key={agent}
                onClick={() => setActiveAgent(agent)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  activeAgent === agent
                    ? 'bg-[#111827] border-[#111827] text-white'
                    : 'bg-white border-[#d1d5db] text-[#1f2937] hover:bg-[#f8fafc]'
                }`}
              >
                <div className="font-medium truncate">{agent}</div>
                <div className="text-[11px] opacity-80">{activeAgent === agent ? 'active' : 'ready'}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-shell min-h-0">
          <div className="flex items-center justify-between pb-2 border-b border-[#e5e7eb]">
            <h2 className="panel-title">Chat</h2>
            <span className="text-xs text-[#64748b]">{activeAgent || 'Select agent'}</span>
          </div>

          <div className="mt-3 flex-1 min-h-0 overflow-y-auto scroll-styled rounded-md border border-[#d1d5db] bg-white p-3 space-y-3">
            {chatHistory.length === 0 && !optimisticUserMsg && streamMessages.length === 0 && !isTyping && (
              <p className="text-xs text-[#64748b]">Start by asking your assistant a task.</p>
            )}

            {chatHistory.map((msg: ChatMessage) => (
              <div key={`db-${msg.id}`} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-md border px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.sender === 'user'
                      ? 'bg-[#eef2ff] border-[#c7d2fe] text-[#1e1b4b]'
                      : 'bg-[#f8fafc] border-[#d1d5db] text-[#0f172a]'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {optimisticUserMsg && (
              <div className="flex justify-end">
                <div className="max-w-[88%] rounded-md border px-3 py-2 text-sm bg-[#eef2ff] border-[#c7d2fe] text-[#1e1b4b] opacity-60">
                  {optimisticUserMsg}
                </div>
              </div>
            )}

            {streamMessages.map((msg: StreamMessage, idx: number) => (
              <div key={`stream-${idx}`} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-md border px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.sender === 'user'
                      ? 'bg-[#eef2ff] border-[#c7d2fe] text-[#1e1b4b]'
                      : 'bg-[#ecfeff] border-[#bae6fd] text-[#0f766e]'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {isTyping && streamMessages.length === 0 && (
              <div className="inline-flex items-center gap-2 rounded-md border border-[#d1d5db] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">
                Assistant is typing...
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleChatSubmit} className="mt-3 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              className="flex-1 rounded-md border border-[#d1d5db] bg-white px-3 py-2 text-sm text-[#111827]"
              placeholder="Ask your agent to plan, build, summarize, or automate"
            />
            <button
              type="submit"
              disabled={!activeAgent || isTyping}
              className="rounded-md border border-[#111827] bg-[#111827] text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </section>
      </div>

      <section className="panel-shell h-[34%]">
        <div className="flex items-center justify-between pb-2 border-b border-[#e5e7eb]">
          <h2 className="panel-title">Activity Log</h2>
          <span className="text-xs text-[#64748b]">live</span>
        </div>

        <div className="mt-3 h-full rounded-md border border-[#d1d5db] bg-white p-3 text-xs overflow-y-auto scroll-styled whitespace-pre-wrap">
          {logs.length === 0 ? (
            <p className="text-[#64748b] italic">Waiting for events...</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="mb-1 pl-2 border-l border-[#e5e7eb] hover:bg-[#f8fafc]">
                {parseLogLine(log)}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </section>
    </div>
  );
}

import React from 'react';
import type { ChatMessage, StreamMessage, TokenUsageSnapshot } from '../types';

interface ChatPanelProps {
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  chatHistory: ChatMessage[];
  streamMessages: StreamMessage[];
  optimisticUserMsg: string | null;
  isTyping: boolean;
  verboseReasoning: boolean;
  setVerboseReasoning: (val: boolean) => void;
  reasoningTapeText: string;
  usageLive: TokenUsageSnapshot | null;
  usageFinal: TokenUsageSnapshot | null;
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
  verboseReasoning,
  setVerboseReasoning,
  reasoningTapeText,
  usageLive,
  usageFinal,
  chatInput,
  setChatInput,
  handleChatSubmit,
  chatEndRef,
  logs,
  logsEndRef,
  parseLogLine,
}: ChatPanelProps) {
  const usage = isTyping ? (usageLive ?? usageFinal) : (usageFinal ?? usageLive);
  const usageStatus = usageFinal ? 'final' : (isTyping ? 'live' : 'latest');

  return (
    <div className="panel-page">
      <div className="grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-3 min-h-0 h-[66%]">
        <section className="panel-shell">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h2 className="panel-title">Agents</h2>
            <span className="text-xs text-text-muted">{agents.length}</span>
          </div>

          <div className="mt-3 space-y-2 overflow-y-auto scroll-styled min-h-0">
            {agents.length === 0 && (
              <p className="text-xs text-text-muted">No agents available.</p>
            )}

            {agents.map(agent => (
              <button
                key={agent}
                onClick={() => setActiveAgent(agent)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  activeAgent === agent
                    ? 'gradient-bg border-transparent text-white'
                    : 'bg-bg-card border-border text-text-muted hover:bg-bg-card-hover hover:text-text'
                }`}
              >
                <div className="font-medium truncate">{agent}</div>
                <div className="text-[11px] opacity-80">{activeAgent === agent ? 'active' : 'ready'}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel-shell min-h-0">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h2 className="panel-title">Chat</h2>
            <span className="text-xs text-text-muted">{activeAgent || 'Select agent'}</span>
          </div>

          <div className="mt-3 rounded-md border border-border bg-bg px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
              <span className="font-semibold uppercase tracking-[0.14em] text-text">Token Meter</span>
              <span className="rounded border border-border px-2 py-0.5">in {usage ? usage.input : '-'}</span>
              <span className="rounded border border-border px-2 py-0.5">out {usage ? usage.output : '-'}</span>
              <span className="rounded border border-border px-2 py-0.5">total {usage ? usage.total : '-'}</span>
              {usage?.estimated && (
                <span className="rounded border border-orange/40 bg-orange/10 px-2 py-0.5 text-orange">estimated</span>
              )}
              <span className="rounded border border-border px-2 py-0.5">{usageStatus}</span>
            </div>
          </div>

          {reasoningTapeText && (
            <div className="mt-2 reasoning-marquee-shell">
              <div className="reasoning-marquee-track">
                <span>{reasoningTapeText}</span>
                <span>{reasoningTapeText}</span>
              </div>
            </div>
          )}

          <div className="mt-2 flex-1 min-h-0 overflow-y-auto scroll-styled rounded-md border border-border bg-bg p-3 space-y-3">
            {chatHistory.length === 0 && !optimisticUserMsg && streamMessages.length === 0 && !isTyping && (
              <p className="text-xs text-text-muted">Start by asking your assistant a task.</p>
            )}

            {chatHistory.map((msg: ChatMessage) => (
              <div key={`db-${msg.id}`} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-md border px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.sender === 'user'
                      ? 'bg-primary/20 border-primary/40 text-text'
                      : 'bg-bg-card border-border text-text'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {optimisticUserMsg && (
              <div className="flex justify-end">
                <div className="max-w-[88%] rounded-md border px-3 py-2 text-sm bg-primary/20 border-primary/40 text-text opacity-60">
                  {optimisticUserMsg}
                </div>
              </div>
            )}

            {streamMessages.map((msg: StreamMessage, idx: number) => (
              <div key={`stream-${idx}`} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-md border px-3 py-2 text-sm whitespace-pre-wrap ${
                    msg.sender === 'user'
                      ? 'bg-primary/20 border-primary/40 text-text'
                      : 'bg-accent/10 border-accent/30 text-text'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {isTyping && streamMessages.length === 0 && (
              <div className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-card px-3 py-2 text-xs text-text-muted">
                Assistant is typing...
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleChatSubmit} className="mt-3 flex flex-col gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={verboseReasoning}
                onChange={e => setVerboseReasoning(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="text-text">Deep reasoning stream</span>
              <span>Higher token usage and latency</span>
            </label>
            <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              className="input-dark flex-1"
              placeholder="Ask your agent to plan, build, summarize, or automate"
            />
            <button
              type="submit"
              disabled={!activeAgent || isTyping}
              className="btn-primary"
            >
              Send
            </button>
            </div>
          </form>
        </section>
      </div>

      <section className="panel-shell h-[34%]">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <h2 className="panel-title">Activity Log</h2>
          <span className="text-xs text-text-muted">live</span>
        </div>

        <div className="mt-3 h-full rounded-md border border-border bg-bg p-3 text-xs overflow-y-auto scroll-styled whitespace-pre-wrap">
          {logs.length === 0 ? (
            <p className="text-text-muted italic">Waiting for events...</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="mb-1 pl-2 border-l border-border hover:bg-bg-card">
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

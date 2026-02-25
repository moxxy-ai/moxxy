import ReactMarkdown from 'react-markdown';

interface MemoryViewerProps {
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  stm: string;
}

export function MemoryViewer({ agents: _agents, activeAgent, setActiveAgent: _setActiveAgent, stm }: MemoryViewerProps) {
  return (
    <div className="panel-page">
      <div className="panel-shell">
        <div className="flex items-center justify-between mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Active Node Memory Bank</h2>
          <span className="text-xs text-[#64748b]">Agent: {activeAgent || 'Not selected'}</span>
        </div>
        <div className="flex-grow bg-[#090d14]/80 p-4 border border-[#1e304f] font-mono text-xs text-[#cbd5e1] overflow-y-auto scroll-styled whitespace-pre-wrap">
          <div className="markdown-body">
            <ReactMarkdown>{stm}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

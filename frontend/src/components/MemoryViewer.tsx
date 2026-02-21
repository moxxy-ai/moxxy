import ReactMarkdown from 'react-markdown';

interface MemoryViewerProps {
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  stm: string;
}

export function MemoryViewer({ agents, activeAgent, setActiveAgent, stm }: MemoryViewerProps) {
  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="bg-[#111927]/90 border border-[#1e304f] p-6 shadow-2xl backdrop-blur-sm h-full flex flex-col">
        <h2 className="text-[#00aaff] uppercase tracking-widest text-sm mb-4 border-b border-[#1e304f] pb-2">Active Node Memory Bank</h2>
        <div className="flex gap-4 mb-4">
          <select
            className="bg-[#090d14] border border-[#1e304f] text-white px-3 py-1.5 outline-none rounded-sm text-sm focus:border-[#00aaff]"
            value={activeAgent || ''}
            onChange={e => setActiveAgent(e.target.value)}
          >
            <option disabled value="">Select Node</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
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

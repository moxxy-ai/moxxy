import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface HeaderProps {
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
}

export function Header({ agents, activeAgent, setActiveAgent }: HeaderProps) {
  const [isAgentMenuOpen, setIsAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!agentMenuRef.current?.contains(event.target as Node)) {
        setIsAgentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <header className="dashboard-header">
      <div className="dashboard-header-inner px-4 md:px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[#64748b]">moxxy</div>
          <h1 className="text-base md:text-lg font-semibold text-[#111827] truncate">Agent Workspace</h1>
        </div>

        <div className="w-full sm:w-auto flex items-center justify-end gap-4 sm:gap-5">
          <div ref={agentMenuRef} className="relative min-w-[140px] sm:min-w-[165px] text-right ml-auto">
            <button
              type="button"
              onClick={() => setIsAgentMenuOpen(open => !open)}
              className="inline-flex items-center gap-1 text-xs leading-none text-[#0f172a] hover:text-[#1d4ed8]"
            >
              <span className="text-[#64748b]">Selected Agent:</span>
              <span className="underline underline-offset-2">{activeAgent || 'None'}</span>
              <ChevronDown
                size={12}
                className={`transition-transform ${isAgentMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isAgentMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 rounded-md border border-[#d1d5db] bg-white shadow-lg overflow-hidden text-left">
                {agents.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[#64748b]">No agents available</div>
                ) : (
                  agents.map(agent => (
                    <button
                      key={agent}
                      type="button"
                      onClick={() => {
                        setActiveAgent(agent);
                        setIsAgentMenuOpen(false);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-[#0f172a] hover:bg-[#eff6ff] flex items-center justify-between"
                    >
                      <span>{agent}</span>
                      {activeAgent === agent && <Check size={13} className="text-[#2563eb]" />}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

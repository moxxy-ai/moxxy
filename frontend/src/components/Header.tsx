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
      <div className="dashboard-header-inner px-4 md:px-6 flex items-center justify-between gap-3 min-h-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/favicon.svg" alt="Moxxy" className="w-8 h-8 shrink-0 align-middle" />
          <span className="text-lg font-bold tracking-tight text-text truncate">moxxy</span>
        </div>

        <div ref={agentMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setIsAgentMenuOpen(open => !open)}
            className="inline-flex items-center gap-1 text-xs leading-none text-text hover:text-primary-light min-w-0 max-w-[50vw] sm:max-w-none"
          >
            <span className="text-text-muted hidden sm:inline">Selected Agent:</span>
            <span className="underline underline-offset-2 truncate">{activeAgent || 'None'}</span>
            <ChevronDown
              size={12}
              className={`shrink-0 transition-transform ${isAgentMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {isAgentMenuOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 sm:w-56 min-w-[180px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-bg-card shadow-lg overflow-hidden text-left">
              {agents.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-muted">No agents available</div>
              ) : (
                agents.map(agent => (
                  <button
                    key={agent}
                    type="button"
                    onClick={() => {
                      setActiveAgent(agent);
                      setIsAgentMenuOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-text hover:bg-bg-card-hover flex items-center justify-between truncate"
                  >
                    <span className="truncate">{agent}</span>
                    {activeAgent === agent && <Check size={13} className="text-primary-light shrink-0 ml-2" />}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

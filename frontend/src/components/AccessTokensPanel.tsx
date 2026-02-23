import { useState } from 'react';
import { Shield } from 'lucide-react';
import type { ApiToken } from '../types';

interface AccessTokensPanelProps {
  apiBase: string;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  apiTokens: ApiToken[];
  setApiTokens: React.Dispatch<React.SetStateAction<ApiToken[]>>;
}

export function AccessTokensPanel({
  apiBase,
  agents,
  activeAgent,
  setActiveAgent,
  apiTokens,
  setApiTokens,
}: AccessTokensPanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const refreshTokens = () => {
    if (activeAgent && apiBase) {
      fetch(`${apiBase}/agents/${activeAgent}/tokens`)
        .then(res => res.json())
        .then(data => { if (data.success) setApiTokens(data.tokens || []); });
    }
  };

  const statusTone = status?.includes('Error:')
    ? 'text-red-400'
    : 'text-emerald-400';

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="bg-[#111927]/90 border border-[#1e304f] p-6 shadow-2xl backdrop-blur-sm h-full flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Access Tokens - {activeAgent || 'No Agent'}</h2>
          <div className="flex items-center gap-3">
            <select
              className="bg-[#090d14] border border-[#1e304f] text-white px-3 py-1.5 outline-none rounded-sm text-xs focus:border-[#00aaff]"
              value={activeAgent || ''}
              onChange={e => setActiveAgent(e.target.value)}
            >
              <option disabled value="">Select Node</option>
              {agents.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <button
              onClick={refreshTokens}
              className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
            >
              Refresh
            </button>
            <button
              onClick={() => { setShowAdd(!showAdd); setStatus(null); setCreatedToken(null); }}
              className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all shadow-[0_0_12px_rgba(0,170,255,0.3)] font-bold"
            >
              {showAdd ? 'Cancel' : '+ Create Token'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="mb-4 p-4 border border-[#00aaff]/30 bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">Create API Token</h3>
            <p className="text-[10px] text-[#94a3b8] mb-3">
              Generate a token for external services to authenticate with this agent's API endpoints.
            </p>

            {createdToken ? (
              <div className="mb-3">
                <div className="p-3 border border-emerald-400/30 bg-emerald-400/5 rounded-sm mb-2">
                  <p className="text-[10px] uppercase tracking-widest text-amber-400 mb-2 font-bold">
                    Save this token - it will not be shown again
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-grow text-sm text-emerald-400 font-mono bg-[#090d14] px-3 py-2 border border-[#1e304f] rounded-sm select-all break-all">
                      {createdToken}
                    </code>
                    <button
                      onClick={() => copyToken(createdToken)}
                      className="shrink-0 bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-2 transition-all font-bold"
                    >
                      {copiedToken ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => { setShowAdd(false); setCreatedToken(null); setNewName(''); setStatus(null); }}
                  className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Token Name</label>
                  <input
                    type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                    placeholder="e.g. my-integration, ci-pipeline, external-service"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      const name = newName.trim();
                      if (!name || !activeAgent) return;
                      setStatus(null);
                      setIsSubmitting(true);
                      try {
                        const res = await fetch(`${apiBase}/agents/${activeAgent}/tokens`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name })
                        });
                        const data = await res.json();
                        if (data.success) {
                          setCreatedToken(data.token);
                          setStatus('Token created');
                          refreshTokens();
                        } else {
                          setStatus(`Error: ${data.error}`);
                        }
                      } catch (err) {
                        setStatus(`Error: ${err}`);
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                    disabled={!newName.trim() || isSubmitting}
                    className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
                  >
                    {isSubmitting ? 'Creating...' : 'Generate Token'}
                  </button>
                  {status && !createdToken && (
                    <span className={`text-[10px] tracking-wide ${statusTone}`}>
                      {status}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {apiTokens.length === 0 ? (
          <div className="flex items-center gap-4 text-sm text-[#64748b] p-4 border border-[#1e304f] bg-[#0d1522] rounded-sm">
            <Shield size={18} className="text-[#385885]" /> No API tokens for this agent. Access is currently open.
          </div>
        ) : (
          <>
            <div className="mb-3 p-3 border border-amber-400/20 bg-amber-400/5 rounded-sm">
              <p className="text-[10px] text-amber-400 tracking-wide">
                {apiTokens.length} token{apiTokens.length !== 1 ? 's' : ''} configured - all API endpoints now require authentication.
              </p>
            </div>
            <div className="flex-grow overflow-y-auto scroll-styled flex flex-col gap-3">
              {apiTokens.map(tk => (
                <div key={tk.id} className="border border-[#1e304f] bg-[#0d1522] p-4 rounded-sm hover:border-[#385885] transition">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Shield size={14} className="text-[#00aaff] shrink-0" />
                      <span className="text-white text-xs font-bold tracking-wide">{tk.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 border border-[#1e304f] text-[#64748b] bg-[#111927] rounded-sm font-mono">
                        {tk.id.slice(0, 8)}…
                      </span>
                      <span className="text-[9px] text-[#64748b]">
                        Created: {tk.created_at}
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        if (!activeAgent) return;
                        setStatus(null);
                        setRemoving(tk.id);
                        try {
                          const res = await fetch(`${apiBase}/agents/${activeAgent}/tokens/${encodeURIComponent(tk.id)}`, { method: 'DELETE' });
                          const data = await res.json();
                          if (data.success) {
                            refreshTokens();
                            setStatus(`Token '${tk.name}' revoked`);
                          } else {
                            setStatus(`Error: ${data.error}`);
                          }
                        } catch (err) {
                          setStatus(`Error: ${err}`);
                        } finally {
                          setRemoving(null);
                        }
                      }}
                      disabled={removing === tk.id}
                      className="shrink-0 bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 disabled:opacity-50 text-red-400 text-[9px] uppercase tracking-widest px-3 py-1 font-bold transition-all"
                    >
                      {removing === tk.id ? 'Revoking...' : 'Revoke'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {status && !showAdd && (
          <div className={`mt-3 text-[10px] tracking-wide ${statusTone}`}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

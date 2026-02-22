import { useState } from 'react';
import { Globe } from 'lucide-react';
import type { Webhook } from '../types';

interface WebhooksPanelProps {
  apiBase: string;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  webhooks: Webhook[];
  setWebhooks: React.Dispatch<React.SetStateAction<Webhook[]>>;
}

export function WebhooksPanel({
  apiBase,
  agents,
  activeAgent,
  setActiveAgent,
  webhooks,
  setWebhooks,
}: WebhooksPanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [copiedSource, setCopiedSource] = useState<string | null>(null);

  const refreshWebhooks = () => {
    if (activeAgent && apiBase) {
      fetch(`${apiBase}/agents/${activeAgent}/webhooks`)
        .then(res => res.json())
        .then(data => { if (data.success) setWebhooks(data.webhooks || []); });
    }
  };

  const statusTone = status?.includes('Error:')
    ? 'text-red-400'
    : status?.includes('Warning:')
      ? 'text-amber-400'
      : 'text-emerald-400';

  const copyUrl = (source: string) => {
    const url = `${apiBase}/webhooks/${activeAgent}/${source}`;
    navigator.clipboard.writeText(url);
    setCopiedSource(source);
    setTimeout(() => setCopiedSource(null), 2000);
  };

  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="bg-[#111927]/90 border border-[#1e304f] p-6 shadow-2xl backdrop-blur-sm h-full flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Webhooks - {activeAgent || 'No Agent'}</h2>
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
              onClick={refreshWebhooks}
              className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
            >
              Refresh
            </button>
            <button
              onClick={() => { setShowAdd(!showAdd); setStatus(null); }}
              className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all shadow-[0_0_12px_rgba(0,170,255,0.3)] font-bold"
            >
              {showAdd ? 'Cancel' : '+ Add Webhook'}
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="mb-4 p-4 border border-[#00aaff]/30 bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">Register Webhook</h3>
            <p className="text-[10px] text-[#94a3b8] mb-3">Register an endpoint for external services like Stripe, GitHub, or Gmail to send events to.</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Name</label>
                <input
                  type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="e.g. stripe-payments"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Source (URL Slug)</label>
                <input
                  type="text" value={newSource} onChange={e => setNewSource(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="e.g. stripe, github, gmail"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Secret (Optional)</label>
              <input
                type="password" value={newSecret} onChange={e => setNewSecret(e.target.value)}
                className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                placeholder="Shared secret for HMAC signature verification"
              />
            </div>
            <div className="mb-3">
              <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Prompt Template</label>
              <textarea
                value={newPrompt} onChange={e => setNewPrompt(e.target.value)}
                className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono h-20 resize-none"
                placeholder="Instructions for the agent when this webhook fires, e.g. 'You received a Stripe payment event. Process the payment details.'"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  const name = newName.trim();
                  const source = newSource.trim().toLowerCase();
                  const prompt_template = newPrompt.trim();
                  if (!name || !source || !prompt_template || !activeAgent) return;
                  setStatus(null);
                  setIsSubmitting(true);
                  try {
                    const res = await fetch(`${apiBase}/agents/${activeAgent}/webhooks`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name, source, secret: newSecret, prompt_template })
                    });
                    const data = await res.json();
                    if (data.success) {
                      setStatus(data.message || 'Webhook registered');
                      setNewName(''); setNewSource(''); setNewSecret(''); setNewPrompt('');
                      refreshWebhooks();
                      setTimeout(() => { setShowAdd(false); }, 1200);
                    } else {
                      setStatus(`Error: ${data.error}`);
                    }
                  } catch (err) {
                    setStatus(`Error: ${err}`);
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                disabled={!newName.trim() || !newSource.trim() || !newPrompt.trim() || isSubmitting}
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
              >
                {isSubmitting ? 'Registering...' : 'Register Webhook'}
              </button>
              {status && (
                <span className={`text-[10px] tracking-wide ${statusTone}`}>
                  {status}
                </span>
              )}
            </div>
          </div>
        )}

        {webhooks.length === 0 ? (
          <div className="flex items-center gap-4 text-sm text-[#64748b] p-4 border border-[#1e304f] bg-[#0d1522] rounded-sm">
            <Globe size={18} className="text-[#385885]" /> No webhooks registered for this agent.
          </div>
        ) : (
          <div className="flex-grow overflow-y-auto scroll-styled flex flex-col gap-3">
            {webhooks.map(wh => (
              <div key={wh.name} className="border border-[#1e304f] bg-[#0d1522] p-4 rounded-sm hover:border-[#385885] transition">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-grow flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-[#00aaff] shrink-0" />
                      <span className="text-white text-xs font-bold tracking-wide">{wh.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 border border-[#1e304f] text-[#64748b] bg-[#111927] rounded-sm font-mono">{wh.source}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold ${wh.active ? 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/30' : 'text-[#64748b] bg-[#111927] border border-[#1e304f]'}`}>
                        {wh.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                      {wh.secret && (
                        <span className="text-[9px] px-1.5 py-0.5 text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-sm font-bold">SIGNED</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-[#64748b] uppercase tracking-widest">URL:</span>
                      <code className="text-[11px] text-[#00aaff] font-mono bg-[#090d14] px-2 py-0.5 border border-[#1e304f] rounded-sm select-all">
                        {apiBase}/webhooks/{activeAgent}/{wh.source}
                      </code>
                      <button
                        onClick={() => copyUrl(wh.source)}
                        className="text-[9px] uppercase tracking-widest text-[#64748b] hover:text-white transition px-2 py-0.5 border border-[#1e304f] bg-[#111927] rounded-sm"
                      >
                        {copiedSource === wh.source ? 'Copied!' : 'Copy'}
                      </button>
                    </div>

                    <p className="text-[11px] text-[#94a3b8] leading-relaxed mt-1">
                      {wh.prompt_template.length > 200 ? wh.prompt_template.slice(0, 200) + '...' : wh.prompt_template}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={async () => {
                        if (!activeAgent) return;
                        setToggling(wh.name);
                        try {
                          const res = await fetch(`${apiBase}/agents/${activeAgent}/webhooks/${encodeURIComponent(wh.name)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ active: !wh.active })
                          });
                          const data = await res.json();
                          if (data.success) {
                            refreshWebhooks();
                          } else {
                            setStatus(`Error: ${data.error}`);
                          }
                        } catch (err) {
                          setStatus(`Error: ${err}`);
                        } finally {
                          setToggling(null);
                        }
                      }}
                      disabled={toggling === wh.name}
                      className={`text-[9px] uppercase tracking-widest px-3 py-1 font-bold transition-all border disabled:opacity-50 ${
                        wh.active
                          ? 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/30 text-amber-400'
                          : 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/30 text-emerald-400'
                      }`}
                    >
                      {toggling === wh.name ? '...' : wh.active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!activeAgent) return;
                        setStatus(null);
                        setRemoving(wh.name);
                        try {
                          const res = await fetch(`${apiBase}/agents/${activeAgent}/webhooks/${encodeURIComponent(wh.name)}`, { method: 'DELETE' });
                          const data = await res.json();
                          if (data.success) {
                            refreshWebhooks();
                            setStatus(data.message || `Webhook '${wh.name}' removed`);
                          } else {
                            setStatus(`Error: ${data.error}`);
                          }
                        } catch (err) {
                          setStatus(`Error: ${err}`);
                        } finally {
                          setRemoving(null);
                        }
                      }}
                      disabled={removing === wh.name}
                      className="shrink-0 bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 disabled:opacity-50 text-red-400 text-[9px] uppercase tracking-widest px-3 py-1 font-bold transition-all"
                    >
                      {removing === wh.name ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
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

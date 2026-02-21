import { useState } from 'react';
import { Cpu } from 'lucide-react';
import type { ChatMessage } from '../types';

interface SwarmOverviewProps {
  apiBase: string;
  agents: string[];
  setAgents: React.Dispatch<React.SetStateAction<string[]>>;
  activeAgent: string | null;
  setActiveAgent: (agent: string | null) => void;
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setStreamMessages: React.Dispatch<React.SetStateAction<{ sender: 'user' | 'agent'; text: string }[]>>;
  setOptimisticUserMsg: React.Dispatch<React.SetStateAction<string | null>>;
  sessionCursorRef: React.MutableRefObject<number>;
  seenIdsRef: React.MutableRefObject<Set<number>>;
}

export function SwarmOverview({
  apiBase,
  agents,
  setAgents,
  activeAgent,
  setActiveAgent,
  setChatHistory,
  setStreamMessages,
  setOptimisticUserMsg,
  sessionCursorRef,
  seenIdsRef,
}: SwarmOverviewProps) {
  const [showProvision, setShowProvision] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeDesc, setNewNodeDesc] = useState('');
  const [newNodeRuntime, setNewNodeRuntime] = useState('native');
  const [newNodeProfile, setNewNodeProfile] = useState('base');
  const [provisionStatus, setProvisionStatus] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="bg-[#111927]/90 border border-[#1e304f] p-6 shadow-2xl backdrop-blur-sm">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Swarm Node Overview</h2>
          <button
            onClick={() => setShowProvision(!showProvision)}
            className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all shadow-[0_0_12px_rgba(0,170,255,0.3)] font-bold"
          >
            {showProvision ? 'Cancel' : '+ Provision Node'}
          </button>
        </div>

        {/* Provision Form */}
        {showProvision && (
          <div className="mb-6 p-4 border border-[#00aaff]/30 bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">New Agent Node</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Node Name</label>
                <input
                  type="text" value={newNodeName} onChange={e => setNewNodeName(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="e.g. recon-alpha"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Description</label>
                <input
                  type="text" value={newNodeDesc} onChange={e => setNewNodeDesc(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="Agent purpose"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Runtime Type</label>
                <select
                  value={newNodeRuntime} onChange={e => setNewNodeRuntime(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] text-white px-3 py-1.5 outline-none text-xs focus:border-[#00aaff]"
                >
                  <option value="native">Native (Direct Execution)</option>
                  <option value="wasm">WASM Container (Isolated)</option>
                </select>
              </div>
              {newNodeRuntime === 'wasm' && (
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Image Profile</label>
                  <select
                    value={newNodeProfile} onChange={e => setNewNodeProfile(e.target.value)}
                    className="w-full bg-[#090d14] border border-[#1e304f] text-white px-3 py-1.5 outline-none text-xs focus:border-[#00aaff]"
                  >
                    <option value="base">Base (128MB, No Network)</option>
                    <option value="networked">Networked (256MB, Network Access)</option>
                    <option value="full">Full (Unlimited, All Capabilities)</option>
                  </select>
                </div>
              )}
            </div>
            {newNodeRuntime === 'wasm' && (
              <div className="text-[10px] text-[#64748b] mb-3 flex items-center gap-2 border border-[#1e304f] p-2 bg-[#111927]">
                <Cpu size={12} className="text-[#00aaff]" />
                <span>WASM agents run inside a Wasmtime sandbox with capability-based isolation. Image: <span className="text-[#00aaff] font-mono">agent_runtime.wasm</span> (86KB)</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  if (!newNodeName.trim()) return;
                  setProvisionStatus('Provisioning...');
                  try {
                    const res = await fetch(`${apiBase}/agents`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        name: newNodeName,
                        description: newNodeDesc,
                        runtime_type: newNodeRuntime,
                        ...(newNodeRuntime === 'wasm' ? { image_profile: newNodeProfile } : {})
                      })
                    });
                    const data = await res.json();
                    if (data.success) {
                      setProvisionStatus('Node provisioned successfully!');
                      setAgents(prev => [...prev, newNodeName]);
                      setNewNodeName(''); setNewNodeDesc('');
                      setNewNodeRuntime('native'); setNewNodeProfile('base');
                      setTimeout(() => { setShowProvision(false); setProvisionStatus(null); }, 2000);
                    } else {
                      setProvisionStatus(`Error: ${data.error}`);
                    }
                  } catch (err) {
                    setProvisionStatus(`Network error: ${err}`);
                  }
                }}
                disabled={!newNodeName.trim()}
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
              >
                Deploy Node
              </button>
              {provisionStatus && (
                <span className={`text-[10px] tracking-wide ${provisionStatus.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                  {provisionStatus}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          {agents.map(agent => (
            <div key={agent} className="border border-[#1e304f] bg-[#0d1522] p-4 rounded-sm flex flex-col gap-3">
              <div className="flexjustify-between items-center flex gap-3">
                <div className="w-10 h-10 border border-[#00aaff] bg-[#0b121f] flex items-center justify-center text-[#00aaff] font-bold shadow-[0_0_10px_rgba(0,170,255,0.3)]">
                  {agent.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="text-white font-bold tracking-wide">{agent}</div>
                  <div className="text-[#00aaff] text-[10px] uppercase flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-[#00aaff] rounded-full animate-pulse"></span> Online</div>
                </div>
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`${apiBase}/agents/${agent}/restart`, { method: 'POST' });
                      const data = await res.json();
                      if (data.success) {
                        setProvisionStatus(`Agent '${agent}' restarted.`);
                        setTimeout(() => setProvisionStatus(null), 3000);
                        if (activeAgent === agent) {
                          setChatHistory([]);
                          setStreamMessages([]);
                          setOptimisticUserMsg(null);
                          sessionCursorRef.current = 0;
                          seenIdsRef.current = new Set();
                          setActiveAgent(null);
                          setTimeout(() => setActiveAgent(agent), 50);
                        }
                      } else {
                        setProvisionStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setProvisionStatus(`Error: ${err}`); }
                  }}
                  className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/30 text-amber-400 text-[9px] uppercase tracking-widest px-3 py-1 font-bold transition-all"
                >
                  Restart
                </button>
                {agent !== 'default' && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Are you sure you want to permanently delete agent '${agent}'? This cannot be undone.`)) return;
                      try {
                        const res = await fetch(`${apiBase}/agents/${agent}`, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                          setAgents(prev => prev.filter(a => a !== agent));
                          setProvisionStatus(`Agent '${agent}' removed.`);
                          setTimeout(() => setProvisionStatus(null), 3000);
                        } else {
                          setProvisionStatus(`Error: ${data.error}`);
                        }
                      } catch (err) { setProvisionStatus(`Error: ${err}`); }
                    }}
                    className="bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-400 text-[9px] uppercase tracking-widest px-3 py-1 font-bold transition-all"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          {agents.length === 0 && <p className="text-[#64748b]">No active agents in swarm.</p>}
        </div>
      </div>
    </div>
  );
}

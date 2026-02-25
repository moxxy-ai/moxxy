import { useState } from 'react';
import { Key } from 'lucide-react';

interface VaultPanelProps {
  apiBase: string;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  vaultKeys: string[];
  setVaultKeys: React.Dispatch<React.SetStateAction<string[]>>;
}

export function VaultPanel({
  apiBase,
  agents: _agents,
  activeAgent,
  setActiveAgent: _setActiveAgent,
  vaultKeys,
  setVaultKeys,
}: VaultPanelProps) {
  const [showAddVaultKey, setShowAddVaultKey] = useState(false);
  const [newVaultKey, setNewVaultKey] = useState('');
  const [newVaultValue, setNewVaultValue] = useState('');
  const [vaultStatus, setVaultStatus] = useState<string | null>(null);
  const [isVaultSubmitting, setIsVaultSubmitting] = useState(false);
  const [removingVaultKey, setRemovingVaultKey] = useState<string | null>(null);

  return (
    <div className="panel-page">
      <div className="panel-shell">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Vault (Secrets) - {activeAgent || 'No Agent'}</h2>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAddVaultKey(!showAddVaultKey)}
              className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all shadow-[0_0_12px_rgba(0,170,255,0.3)] font-bold"
            >
              {showAddVaultKey ? 'Cancel' : '+ Add Secret'}
            </button>
          </div>
        </div>

        {showAddVaultKey && (
          <div className="mb-6 p-4 border border-[#00aaff]/30 bg-[#0b121f] rounded-sm flex flex-col gap-3">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-1">New Secret Key-Value</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Key Name</label>
                <input
                  type="text" value={newVaultKey} onChange={e => setNewVaultKey(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="e.g. openai_api_key"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Value / Token</label>
                <input
                  type="password" value={newVaultValue} onChange={e => setNewVaultValue(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="sk-..."
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={async () => {
                  if (!activeAgent || !newVaultKey.trim() || !newVaultValue.trim()) return;
                  setIsVaultSubmitting(true);
                  setVaultStatus('Saving secret...');
                  try {
                    const res = await fetch(`${apiBase}/agents/${activeAgent}/vault`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: newVaultKey, value: newVaultValue })
                    });
                    const data = await res.json();
                    if (data.success) {
                      setVaultStatus('Secret saved successfully.');
                      if (!vaultKeys.includes(newVaultKey)) {
                        setVaultKeys(prev => [...prev, newVaultKey]);
                      }
                      setNewVaultKey('');
                      setNewVaultValue('');
                      setTimeout(() => { setShowAddVaultKey(false); setVaultStatus(null); }, 2000);
                    } else {
                      setVaultStatus(`Error: ${data.error}`);
                    }
                  } catch (err) { setVaultStatus(`Error: ${err}`); }
                  setIsVaultSubmitting(false);
                }}
                disabled={!activeAgent || !newVaultKey.trim() || !newVaultValue.trim() || isVaultSubmitting}
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
              >
                {isVaultSubmitting ? 'Saving...' : 'Save Secret'}
              </button>
              {vaultStatus && (
                <span className={`text-[10px] tracking-wide ${vaultStatus.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                  {vaultStatus}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex-grow overflow-y-auto scroll-styled grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
          {vaultKeys.map(key => (
            <div key={key} className="border border-[#1e304f] bg-[#0d1522] p-4 rounded-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-[#00aaff] shrink-0" />
                  <span className="text-white text-xs font-bold tracking-wide font-mono break-all">{key}</span>
                </div>
                <span className="text-[9px] px-2 py-0.5 border border-emerald-400/30 text-emerald-400 bg-emerald-400/5 rounded-sm uppercase tracking-widest shrink-0">Secured</span>
              </div>
              <div className="flex justify-end gap-2 mt-1">
                <button
                  className="text-[10px] text-[#00aaff] hover:underline uppercase tracking-widest"
                  onClick={() => {
                    setNewVaultKey(key);
                    setNewVaultValue('');
                    setShowAddVaultKey(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Edit
                </button>
                {removingVaultKey === key ? (
                  <span className="text-red-400 text-[10px] uppercase tracking-widest">Removing...</span>
                ) : (
                  <button
                    className="text-[10px] text-red-500 hover:text-red-400 hover:underline uppercase tracking-widest"
                    onClick={async () => {
                      if (!confirm(`Remove secret '${key}'? Tasks depending on this key will fail.`)) return;
                      setRemovingVaultKey(key);
                      try {
                        const res = await fetch(`${apiBase}/agents/${activeAgent}/vault/${key}`, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                          setVaultKeys(prev => prev.filter(k => k !== key));
                        } else {
                          alert(`Failed to remove secret: ${data.error}`);
                        }
                      } catch (err) {
                        alert(`Failed to remove secret: ${err}`);
                      }
                      setRemovingVaultKey(null);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          {vaultKeys.length === 0 && (
            <div className="col-span-1 md:col-span-2 xl:col-span-3 text-[#64748b] italic text-xs">No secrets stored in vault.</div>
          )}
        </div>
      </div>
    </div>
  );
}

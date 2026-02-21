import { useState, useEffect } from 'react';

interface ProviderInfo {
  id: string;
  name: string;
  default_model: string;
  models: { id: string; name: string }[];
}

interface ConfigPanelProps {
  apiBase: string;
  setApiBase: (val: string) => void;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
}

export function ConfigPanel({
  apiBase,
  setApiBase,
  agents,
  activeAgent,
  setActiveAgent,
}: ConfigPanelProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [llmProvider, setLlmProvider] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmStatus, setLlmStatus] = useState<string | null>(null);

  const [gatewayHost, setGatewayHost] = useState('');
  const [gatewayPort, setGatewayPort] = useState<number>(17890);
  const [webUiPort, setWebUiPort] = useState<number>(3001);
  const [globalConfigStatus, setGlobalConfigStatus] = useState<string | null>(null);

  // Fetch provider registry
  useEffect(() => {
    if (!apiBase) return;
    fetch(`${apiBase}/providers`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setProviders(data.providers || []);
      })
      .catch(() => {});
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase) return;
    fetch(`${apiBase}/config/global`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setGatewayHost(data.gateway_host);
          setGatewayPort(data.gateway_port);
          setWebUiPort(data.web_ui_port);
        }
      })
      .catch(err => console.error("Failed to fetch global config", err));
  }, [apiBase]);

  // Fetch LLM info when active agent changes
  useEffect(() => {
    if (!activeAgent || !apiBase) return;
    fetch(`${apiBase}/agents/${activeAgent}/llm`)
      .then(r => r.json())
      .then(d => { if (d.success) { setLlmProvider(d.provider || ''); setLlmModel(d.model || ''); } })
      .catch(() => { /* ignore */ });
  }, [activeAgent, apiBase]);

  const selectedProvider = providers.find(p => p.id === llmProvider);

  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="bg-[#111927]/90 border border-[#1e304f] p-6 shadow-2xl backdrop-blur-sm">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Agent Configuration - {activeAgent || 'No Agent'}</h2>
          <select
            className="bg-[#090d14] border border-[#1e304f] text-white px-3 py-1.5 outline-none rounded-sm text-xs focus:border-[#00aaff]"
            value={activeAgent || ''}
            onChange={e => {
              setActiveAgent(e.target.value);
              setLlmStatus(null);
            }}
          >
            <option disabled value="">Select Node</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-xs uppercase tracking-widest text-[#94a3b8] mb-1">LLM Provider</label>
            <select
              value={llmProvider}
              onChange={e => {
                const newProvider = e.target.value;
                setLlmProvider(newProvider);
                const prov = providers.find(p => p.id === newProvider);
                if (prov) setLlmModel(prov.default_model);
              }}
              className="w-full bg-[#090d14] border border-[#1e304f] text-white px-3 py-2 rounded-sm text-sm focus:border-[#00aaff] outline-none"
            >
              <option value="">Select Provider</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-[#94a3b8] mb-1">Model</label>
            {selectedProvider && selectedProvider.models.length > 0 ? (
              <select
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                className="w-full bg-[#090d14] border border-[#1e304f] text-white px-3 py-2 rounded-sm text-sm focus:border-[#00aaff] outline-none"
              >
                <option value="">Select Model</option>
                {selectedProvider.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none text-white px-3 py-2 rounded-sm text-sm font-mono"
                placeholder="e.g. gpt-4o, gemini-2.0-flash"
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                if (!activeAgent || !llmProvider || !llmModel) return;
                setLlmStatus(null);
                try {
                  const res = await fetch(`${apiBase}/agents/${activeAgent}/llm`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider: llmProvider, model: llmModel })
                  });
                  const data = await res.json();
                  if (data.success) {
                    setLlmStatus('LLM configuration saved successfully.');
                  } else {
                    setLlmStatus(`Error: ${data.error}`);
                  }
                } catch (err) { setLlmStatus(`Error: ${err}`); }
              }}
              disabled={!llmProvider || !llmModel}
              className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
            >
              Save LLM Config
            </button>
            {llmStatus && (
              <span className={`text-[10px] ${llmStatus.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{llmStatus}</span>
            )}
          </div>
          <div className="border-t border-[#1e304f] pt-6 mt-6">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-4">Global System Configuration</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Gateway Host</label>
                <input
                  type="text"
                  value={gatewayHost}
                  onChange={e => setGatewayHost(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none text-white px-3 py-2 rounded-sm text-sm font-mono"
                  placeholder="127.0.0.1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Gateway Port</label>
                  <input
                    type="number"
                    value={gatewayPort}
                    onChange={e => setGatewayPort(parseInt(e.target.value))}
                    className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none text-white px-3 py-2 rounded-sm text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Web UI Port</label>
                  <input
                    type="number"
                    value={webUiPort}
                    onChange={e => setWebUiPort(parseInt(e.target.value))}
                    className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none text-white px-3 py-2 rounded-sm text-sm font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    setGlobalConfigStatus('Saving...');
                    try {
                      const res = await fetch(`${apiBase}/config/global`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          gateway_host: gatewayHost,
                          gateway_port: gatewayPort,
                          web_ui_port: webUiPort
                        })
                      });
                      const data = await res.json();
                      if (data.success) {
                        setGlobalConfigStatus('Config saved. Restarting gateway...');
                        try {
                          await fetch(`${apiBase}/gateway/restart`, { method: 'POST' });
                        } catch {
                          // Expected -- gateway dies before responding
                        }
                        setGlobalConfigStatus('Gateway restarting. Reconnecting...');
                        const newBase = `http://${gatewayHost}:${gatewayPort}/api`;
                        const tryReconnect = async (attempts: number) => {
                          for (let i = 0; i < attempts; i++) {
                            await new Promise(r => setTimeout(r, 2000));
                            try {
                              const probe = await fetch(`${newBase}/agents`, { signal: AbortSignal.timeout(3000) });
                              if (probe.ok) {
                                setApiBase(newBase);
                                setGlobalConfigStatus('Gateway restarted successfully.');
                                return;
                              }
                            } catch { /* still restarting */ }
                            setGlobalConfigStatus(`Gateway restarting. Reconnecting... (${i + 1}/${attempts})`);
                          }
                          setGlobalConfigStatus('Gateway may have restarted on the new port. Refresh the page if needed.');
                        };
                        void tryReconnect(15);
                      } else {
                        setGlobalConfigStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setGlobalConfigStatus(`Error: ${err}`); }
                  }}
                  className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
                >
                  Save &amp; Restart Gateway
                </button>
                {globalConfigStatus && (
                  <span className={`text-[10px] ${globalConfigStatus.includes('Error') ? 'text-red-400' : globalConfigStatus.includes('Reconnecting') ? 'text-amber-400 animate-pulse' : 'text-emerald-400'}`}>{globalConfigStatus}</span>
                )}
              </div>

              <p className="text-[10px] text-[#64748b] mt-1">Saving will restart the gateway process. Active connections will briefly disconnect.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

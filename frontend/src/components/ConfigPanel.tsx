import { useState, useEffect } from 'react';

interface ProviderInfo {
  id: string;
  name: string;
  default_model: string;
  custom?: boolean;
  vault_key?: string;
  models: { id: string; name: string }[];
}

interface CustomProviderForm {
  id: string;
  name: string;
  api_format: string;
  base_url: string;
  auth_type: string;
  vault_key: string;
  default_model: string;
  models_text: string;
}

const emptyForm: CustomProviderForm = {
  id: '',
  name: '',
  api_format: 'openai',
  base_url: '',
  auth_type: 'bearer',
  vault_key: '',
  default_model: '',
  models_text: '',
};

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
  const [customModelId, setCustomModelId] = useState('');
  const [llmStatus, setLlmStatus] = useState<string | null>(null);
  const [apiToken, setApiToken] = useState('');
  const [apiTokenStatus, setApiTokenStatus] = useState<string | null>(null);

  const [gatewayHost, setGatewayHost] = useState('');
  const [gatewayPort, setGatewayPort] = useState<number>(17890);
  const [webUiPort, setWebUiPort] = useState<number>(3001);
  const [globalConfigStatus, setGlobalConfigStatus] = useState<string | null>(null);

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState<CustomProviderForm>(emptyForm);
  const [customStatus, setCustomStatus] = useState<string | null>(null);

  const fetchProviders = () => {
    if (!apiBase) return;
    fetch(`${apiBase}/providers`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setProviders(data.providers || []);
      })
      .catch(() => {});
  };

  // Fetch provider registry
  useEffect(() => {
    fetchProviders();
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
  const customProviders = providers.filter(p => p.custom);
  const isCustomModel = llmModel === '__custom__';

  useEffect(() => {
    if (!activeAgent || !llmProvider || !apiBase) return;
    const prov = providers.find(p => p.id === llmProvider);
    if (!prov?.vault_key) {
      setApiToken('');
      return;
    }
    fetch(`${apiBase}/agents/${activeAgent}/vault/${prov.vault_key}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.value) setApiToken(d.value);
        else setApiToken('');
      })
      .catch(() => setApiToken(''));
  }, [activeAgent, llmProvider, apiBase, providers]);

  const getModelToSend = () => isCustomModel ? customModelId : llmModel;

  const handleAddCustomProvider = async () => {
    setCustomStatus(null);
    const models = customForm.models_text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(':');
        return parts.length >= 2
          ? { id: parts[0].trim(), name: parts.slice(1).join(':').trim() }
          : { id: line, name: line };
      });

    const authObj: Record<string, string> = { type: customForm.auth_type, vault_key: customForm.vault_key };
    if (customForm.auth_type === 'header') {
      authObj.header_name = 'x-api-key';
    }

    const payload = {
      id: customForm.id,
      name: customForm.name,
      api_format: customForm.api_format,
      base_url: customForm.base_url,
      auth: authObj,
      default_model: customForm.default_model || (models[0]?.id ?? ''),
      models,
      extra_headers: {},
      custom: true,
    };

    try {
      const res = await fetch(`${apiBase}/providers/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setCustomStatus('Provider added. Restart agents to use it.');
        setCustomForm(emptyForm);
        setShowCustomForm(false);
        fetchProviders();
      } else {
        setCustomStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setCustomStatus(`Error: ${err}`);
    }
  };

  const handleDeleteCustomProvider = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/providers/custom/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchProviders();
        setCustomStatus('Provider removed.');
      } else {
        setCustomStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setCustomStatus(`Error: ${err}`);
    }
  };

  const inputClass = "w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none text-white px-3 py-2 rounded-sm text-sm font-mono";
  const selectClass = "w-full bg-[#090d14] border border-[#1e304f] text-white px-3 py-2 rounded-sm text-sm focus:border-[#00aaff] outline-none";
  const labelClass = "block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1";
  const btnClass = "bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all";

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
            <label className={labelClass}>LLM Provider</label>
            <select
              value={llmProvider}
              onChange={e => {
                const newProvider = e.target.value;
                setLlmProvider(newProvider);
                const prov = providers.find(p => p.id === newProvider);
                if (prov) setLlmModel(prov.default_model);
              }}
              className={selectClass}
            >
              <option value="">Select Provider</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}{p.custom ? ' (custom)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Model</label>
            {selectedProvider && selectedProvider.models.length > 0 ? (
              <>
                <select
                  value={llmModel}
                  onChange={e => setLlmModel(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select Model</option>
                  {selectedProvider.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  <option value="__custom__">Custom Model ID...</option>
                </select>
                {isCustomModel && (
                  <input
                    type="text"
                    value={customModelId}
                    onChange={e => setCustomModelId(e.target.value)}
                    className={`${inputClass} mt-2`}
                    placeholder="e.g. gpt-4o-2024-11-20, claude-3-opus"
                  />
                )}
              </>
            ) : (
              <input
                type="text"
                value={llmModel}
                onChange={e => setLlmModel(e.target.value)}
                className={inputClass}
                placeholder="e.g. gpt-4o, gemini-2.0-flash"
              />
            )}
          </div>
          {selectedProvider?.vault_key && (
            <div>
              <label className={labelClass}>API Token (stored in vault)</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiToken}
                  onChange={e => setApiToken(e.target.value)}
                  className={inputClass}
                  placeholder={`Enter ${selectedProvider.name} API key`}
                />
                <button
                  onClick={async () => {
                    if (!activeAgent || !selectedProvider?.vault_key || !apiToken.trim()) return;
                    setApiTokenStatus(null);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/vault`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: selectedProvider.vault_key, value: apiToken })
                      });
                      const data = await res.json();
                      if (data.success) {
                        setApiTokenStatus('Token saved.');
                      } else {
                        setApiTokenStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setApiTokenStatus(`Error: ${err}`); }
                  }}
                  disabled={!activeAgent || !apiToken.trim()}
                  className="bg-[#1e304f] hover:bg-[#2a4a6f] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-4 py-2 whitespace-nowrap"
                >
                  Save
                </button>
              </div>
              {apiTokenStatus && (
                <span className={`text-[10px] mt-1 block ${apiTokenStatus.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{apiTokenStatus}</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                const modelToSend = getModelToSend();
                if (!activeAgent || !llmProvider || !modelToSend) return;
                setLlmStatus(null);
                try {
                  const res = await fetch(`${apiBase}/agents/${activeAgent}/llm`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider: llmProvider, model: modelToSend })
                  });
                  const data = await res.json();
                  if (data.success) {
                    setLlmStatus('LLM configuration saved successfully.');
                  } else {
                    setLlmStatus(`Error: ${data.error}`);
                  }
                } catch (err) { setLlmStatus(`Error: ${err}`); }
              }}
              disabled={!llmProvider || !getModelToSend()}
              className={btnClass}
            >
              Save LLM Config
            </button>
            {llmStatus && (
              <span className={`text-[10px] ${llmStatus.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{llmStatus}</span>
            )}
          </div>

          {/* Custom Providers Section */}
          <div className="border-t border-[#1e304f] pt-6 mt-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest">Custom Providers</h3>
              <button
                onClick={() => setShowCustomForm(!showCustomForm)}
                className="text-[#00aaff] hover:text-[#33bfff] text-[10px] uppercase tracking-widest border border-[#1e304f] px-3 py-1 transition-all"
              >
                {showCustomForm ? 'Cancel' : '+ Add Provider'}
              </button>
            </div>

            {customStatus && (
              <p className={`text-[10px] mb-3 ${customStatus.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{customStatus}</p>
            )}

            {/* Existing custom providers list */}
            {customProviders.length > 0 && (
              <div className="space-y-2 mb-4">
                {customProviders.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-[#090d14] border border-[#1e304f] px-3 py-2 rounded-sm">
                    <div>
                      <span className="text-white text-sm">{p.name}</span>
                      <span className="text-[#64748b] text-[10px] ml-2">({p.id})</span>
                      <span className="text-[#64748b] text-[10px] ml-2">{p.models.length} models</span>
                    </div>
                    <button
                      onClick={() => handleDeleteCustomProvider(p.id)}
                      className="text-red-400 hover:text-red-300 text-[10px] uppercase tracking-widest"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {customProviders.length === 0 && !showCustomForm && (
              <p className="text-[10px] text-[#64748b]">No custom providers configured. Add one to connect local LLMs (Ollama, LM Studio, vLLM) or other OpenAI-compatible APIs.</p>
            )}

            {/* Add custom provider form */}
            {showCustomForm && (
              <div className="space-y-3 bg-[#090d14] border border-[#1e304f] p-4 rounded-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Provider ID</label>
                    <input type="text" value={customForm.id} onChange={e => setCustomForm({ ...customForm, id: e.target.value })} className={inputClass} placeholder="e.g. ollama, lmstudio" />
                  </div>
                  <div>
                    <label className={labelClass}>Display Name</label>
                    <input type="text" value={customForm.name} onChange={e => setCustomForm({ ...customForm, name: e.target.value })} className={inputClass} placeholder="e.g. Ollama (Local)" />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Base URL</label>
                  <input type="text" value={customForm.base_url} onChange={e => setCustomForm({ ...customForm, base_url: e.target.value })} className={inputClass} placeholder="e.g. http://localhost:11434/v1/chat/completions" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>API Format</label>
                    <select value={customForm.api_format} onChange={e => setCustomForm({ ...customForm, api_format: e.target.value })} className={selectClass}>
                      <option value="openai">OpenAI-compatible</option>
                      <option value="gemini">Gemini</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Auth Type</label>
                    <select value={customForm.auth_type} onChange={e => setCustomForm({ ...customForm, auth_type: e.target.value })} className={selectClass}>
                      <option value="bearer">Bearer Token</option>
                      <option value="header">Custom Header</option>
                      <option value="query_param">Query Parameter</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Vault Key (for API key)</label>
                    <input type="text" value={customForm.vault_key} onChange={e => setCustomForm({ ...customForm, vault_key: e.target.value })} className={inputClass} placeholder="e.g. ollama_api_key" />
                  </div>
                  <div>
                    <label className={labelClass}>Default Model</label>
                    <input type="text" value={customForm.default_model} onChange={e => setCustomForm({ ...customForm, default_model: e.target.value })} className={inputClass} placeholder="e.g. llama3.3:70b" />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Models (one per line: id:display name)</label>
                  <textarea
                    value={customForm.models_text}
                    onChange={e => setCustomForm({ ...customForm, models_text: e.target.value })}
                    className={`${inputClass} h-20 resize-none`}
                    placeholder={"llama3.3:70b:Llama 3.3 70B\nqwen3:32b:Qwen 3 32B\ndeepseek-r1:14b:DeepSeek R1 14B"}
                  />
                </div>
                <button
                  onClick={handleAddCustomProvider}
                  disabled={!customForm.id || !customForm.name || !customForm.base_url || !customForm.vault_key}
                  className={btnClass}
                >
                  Add Custom Provider
                </button>
              </div>
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
                  className={inputClass}
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
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Web UI Port</label>
                  <input
                    type="number"
                    value={webUiPort}
                    onChange={e => setWebUiPort(parseInt(e.target.value))}
                    className={inputClass}
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
                  className={btnClass}
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

import { useEffect, useMemo, useState } from 'react';
import type { ProviderInfo } from '../types';

interface CustomProviderForm {
  id: string;
  name: string;
  base_url: string;
  vault_key: string;
  default_model: string;
  models_text: string;
}

const emptyCustomForm: CustomProviderForm = {
  id: '',
  name: '',
  base_url: '',
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
  agents: _agents,
  activeAgent,
  setActiveAgent: _setActiveAgent,
}: ConfigPanelProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [customForm, setCustomForm] = useState<CustomProviderForm>(emptyCustomForm);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customStatus, setCustomStatus] = useState<string | null>(null);

  const [apiBaseInput, setApiBaseInput] = useState(apiBase);
  const [apiBaseStatus, setApiBaseStatus] = useState<string | null>(null);

  const [gatewayHost, setGatewayHost] = useState('');
  const [gatewayPort, setGatewayPort] = useState<number>(17890);
  const [webUiPort, setWebUiPort] = useState<number>(3001);
  const [globalConfigStatus, setGlobalConfigStatus] = useState<string | null>(null);

  const customProviders = useMemo(() => providers.filter(p => p.custom), [providers]);

  const fetchProviders = () => {
    if (!apiBase) return;
    fetch(`${apiBase}/providers`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setProviders(data.providers || []);
        }
      })
      .catch(() => setProviders([]));
  };

  useEffect(() => {
    setApiBaseInput(apiBase);
  }, [apiBase]);

  useEffect(() => {
    fetchProviders();
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase) return;
    fetch(`${apiBase}/config/global`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          setGlobalConfigStatus('Global config unavailable. Ensure the default agent exists.');
          return;
        }
        setGatewayHost(data.gateway_host || '127.0.0.1');
        setGatewayPort(data.gateway_port || 17890);
        setWebUiPort(data.web_ui_port || 3001);
      })
      .catch(() => setGlobalConfigStatus('Unable to load gateway configuration.'));
  }, [apiBase]);

  const addCustomProvider = async () => {
    setCustomStatus(null);

    const models = customForm.models_text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const firstColon = line.indexOf(':');
        if (firstColon === -1) {
          return { id: line, name: line };
        }
        const id = line.slice(0, firstColon).trim();
        const name = line.slice(firstColon + 1).trim() || id;
        return { id, name };
      });

    if (models.length === 0 && customForm.default_model.trim()) {
      models.push({ id: customForm.default_model.trim(), name: customForm.default_model.trim() });
    }

    const payload = {
      id: customForm.id.trim(),
      name: customForm.name.trim(),
      api_format: 'openai',
      base_url: customForm.base_url.trim(),
      auth: {
        type: 'bearer',
        vault_key: customForm.vault_key.trim(),
      },
      default_model: customForm.default_model.trim() || models[0]?.id || '',
      models,
      extra_headers: {},
      custom: true,
    };

    if (!payload.id || !payload.name || !payload.base_url || !payload.auth.vault_key || !payload.default_model) {
      setCustomStatus('Please fill all required fields.');
      return;
    }

    try {
      const res = await fetch(`${apiBase}/providers/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: { success?: boolean; error?: string } = await res.json();
      if (data.success) {
        setCustomStatus('Custom provider added. Use it from Overview > Provider Setup.');
        setCustomForm(emptyCustomForm);
        setShowCustomForm(false);
        fetchProviders();
      } else {
        setCustomStatus(`Error: ${data.error || 'Could not add provider.'}`);
      }
    } catch (err) {
      setCustomStatus(`Error: ${String(err)}`);
    }
  };

  const removeCustomProvider = async (providerId: string) => {
    setCustomStatus(null);
    try {
      const res = await fetch(`${apiBase}/providers/custom/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
      const data: { success?: boolean; error?: string } = await res.json();
      if (data.success) {
        setCustomStatus('Provider removed.');
        fetchProviders();
      } else {
        setCustomStatus(`Error: ${data.error || 'Could not remove provider.'}`);
      }
    } catch (err) {
      setCustomStatus(`Error: ${String(err)}`);
    }
  };

  const saveGlobalConfig = async () => {
    setGlobalConfigStatus('Saving...');
    try {
      const res = await fetch(`${apiBase}/config/global`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway_host: gatewayHost,
          gateway_port: gatewayPort,
          web_ui_port: webUiPort,
        }),
      });
      const data: { success?: boolean; error?: string } = await res.json();
      if (!data.success) {
        setGlobalConfigStatus(`Error: ${data.error || 'Unable to save global config.'}`);
        return;
      }

      setGlobalConfigStatus('Saved. Restarting gateway...');
      try {
        await fetch(`${apiBase}/gateway/restart`, { method: 'POST' });
      } catch {
        // Gateway usually drops before responding.
      }

      setGlobalConfigStatus('Gateway restarting. It may take a few seconds.');
    } catch (err) {
      setGlobalConfigStatus(`Error: ${String(err)}`);
    }
  };

  const applyApiBase = () => {
    if (!apiBaseInput.trim()) {
      setApiBaseStatus('API base cannot be empty.');
      return;
    }
    setApiBase(apiBaseInput.trim());
    setApiBaseStatus('API base updated.');
  };

  return (
    <div className="panel-page">
      <div className="panel-shell">
        <div className="mb-4 border-b border-[#d1d5db] pb-3">
          <h2 className="text-lg font-semibold text-[#111827]">Configuration</h2>
          <p className="text-sm text-[#64748b] mt-1">
            Provider selection moved to Overview so users can configure it during agent creation.
          </p>
        </div>

        <div className="space-y-4 overflow-y-auto scroll-styled pr-1">
          <section className="rounded-lg border border-[#d1d5db] bg-white p-4">
            <h3 className="text-sm font-semibold text-[#111827] mb-2">Current Agent Context</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#111827]">Active agent: <strong>{activeAgent || 'Not selected'}</strong></span>
            </div>
          </section>

          <section className="rounded-lg border border-[#d1d5db] bg-white p-4">
            <h3 className="text-sm font-semibold text-[#111827] mb-3">Web UI API Endpoint</h3>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                type="text"
                value={apiBaseInput}
                onChange={e => setApiBaseInput(e.target.value)}
                className="flex-1 rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                placeholder="http://127.0.0.1:17890/api"
              />
              <button
                onClick={applyApiBase}
                className="rounded-md border border-[#111827] bg-[#111827] text-white px-4 py-2 text-xs font-medium"
              >
                Update API Base
              </button>
            </div>
            {apiBaseStatus && <p className="text-xs text-emerald-700 mt-2">{apiBaseStatus}</p>}
          </section>

          <section className="rounded-lg border border-[#d1d5db] bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#111827]">Custom Providers (Advanced)</h3>
              <button
                onClick={() => setShowCustomForm(prev => !prev)}
                className="rounded-md border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1.5 text-xs text-[#334155]"
              >
                {showCustomForm ? 'Cancel' : 'Add Provider'}
              </button>
            </div>

            {customProviders.length === 0 && !showCustomForm && (
              <p className="text-sm text-[#64748b]">No custom providers configured.</p>
            )}

            {customProviders.length > 0 && (
              <div className="space-y-2 mb-3">
                {customProviders.map(provider => (
                  <div key={provider.id} className="rounded-md border border-[#e5e7eb] p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#111827]">{provider.name} <span className="text-xs text-[#64748b]">({provider.id})</span></div>
                      <div className="text-xs text-[#64748b] truncate">{provider.base_url}</div>
                    </div>
                    <button
                      onClick={() => removeCustomProvider(provider.id)}
                      className="rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-1 text-xs text-[#b91c1c]"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showCustomForm && (
              <div className="rounded-md border border-[#e5e7eb] bg-[#f8fafc] p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Provider ID</label>
                    <input
                      type="text"
                      value={customForm.id}
                      onChange={e => setCustomForm(prev => ({ ...prev, id: e.target.value }))}
                      className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                      placeholder="e.g. ollama"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Display Name</label>
                    <input
                      type="text"
                      value={customForm.name}
                      onChange={e => setCustomForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                      placeholder="e.g. Ollama Local"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Base URL</label>
                    <input
                      type="text"
                      value={customForm.base_url}
                      onChange={e => setCustomForm(prev => ({ ...prev, base_url: e.target.value }))}
                      className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                      placeholder="http://localhost:11434/v1/chat/completions"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Vault Key</label>
                    <input
                      type="text"
                      value={customForm.vault_key}
                      onChange={e => setCustomForm(prev => ({ ...prev, vault_key: e.target.value }))}
                      className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                      placeholder="ollama_api_key"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Default Model</label>
                    <input
                      type="text"
                      value={customForm.default_model}
                      onChange={e => setCustomForm(prev => ({ ...prev, default_model: e.target.value }))}
                      className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                      placeholder="llama3.1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">Models (id:name per line)</label>
                    <textarea
                      value={customForm.models_text}
                      onChange={e => setCustomForm(prev => ({ ...prev, models_text: e.target.value }))}
                      className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm h-20 resize-none"
                      placeholder={'llama3.1:Llama 3.1\nqwen2.5:Qwen 2.5'}
                    />
                  </div>
                </div>

                <button
                  onClick={addCustomProvider}
                  className="rounded-md border border-[#111827] bg-[#111827] text-white px-4 py-2 text-xs font-medium"
                >
                  Save Custom Provider
                </button>
              </div>
            )}

            {customStatus && (
              <p className={`text-xs mt-2 ${customStatus.startsWith('Error') ? 'text-red-600' : 'text-emerald-700'}`}>
                {customStatus}
              </p>
            )}
          </section>

          <section className="rounded-lg border border-[#d1d5db] bg-white p-4">
            <h3 className="text-sm font-semibold text-[#111827] mb-3">Gateway Network Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-[#64748b] mb-1">Gateway Host</label>
                <input
                  type="text"
                  value={gatewayHost}
                  onChange={e => setGatewayHost(e.target.value)}
                  className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#64748b] mb-1">Gateway Port</label>
                <input
                  type="number"
                  value={gatewayPort}
                  onChange={e => setGatewayPort(Number(e.target.value) || gatewayPort)}
                  className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[#64748b] mb-1">Web UI Port</label>
                <input
                  type="number"
                  value={webUiPort}
                  onChange={e => setWebUiPort(Number(e.target.value) || webUiPort)}
                  className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                />
              </div>
            </div>

            <button
              onClick={saveGlobalConfig}
              className="rounded-md border border-[#111827] bg-[#111827] text-white px-4 py-2 text-xs font-medium"
            >
              Save & Restart Gateway
            </button>

            {globalConfigStatus && (
              <p className={`text-xs mt-2 ${globalConfigStatus.startsWith('Error') ? 'text-red-600' : 'text-emerald-700'}`}>
                {globalConfigStatus}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

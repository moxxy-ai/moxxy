import { useEffect, useMemo, useState } from 'react';
import { Cpu } from 'lucide-react';
import type { ChatMessage, ProviderInfo } from '../types';
import { AppSelect } from './ui/AppSelect';

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

type OperationResult = {
  ok: boolean;
  message: string;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [providerCustomModel, setProviderCustomModel] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerStatus, setProviderStatus] = useState<string | null>(null);
  const [isApplyingProvider, setIsApplyingProvider] = useState(false);

  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeDesc, setNewNodeDesc] = useState('');
  const [newNodeRuntime, setNewNodeRuntime] = useState('native');
  const [newNodeProfile, setNewNodeProfile] = useState('base');
  const [provisionStatus, setProvisionStatus] = useState<string | null>(null);
  const [isProvisioning, setIsProvisioning] = useState(false);

  useEffect(() => {
    if (!apiBase) return;
    fetch(`${apiBase}/providers`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) return;
        const next: ProviderInfo[] = data.providers || [];
        setProviders(next);
      })
      .catch(() => setProviders([]));
  }, [apiBase]);

  useEffect(() => {
    if (providers.length === 0) return;
    const selected = providers.find(p => p.id === providerId);
    if (!selected) {
      setProviderId(providers[0].id);
      setProviderModel(providers[0].default_model || providers[0].models[0]?.id || '');
    }
  }, [providers, providerId]);

  const selectedProvider = useMemo(
    () => providers.find(p => p.id === providerId) ?? null,
    [providers, providerId]
  );

  const resolvedModel = providerModel === '__custom__' ? providerCustomModel.trim() : providerModel;

  const applyProviderToAgent = async (agentName: string, silent = false): Promise<OperationResult> => {
    if (!selectedProvider) {
      return { ok: false, message: 'Select a provider first.' };
    }

    if (!resolvedModel) {
      return { ok: false, message: 'Select a model first.' };
    }

    const maxAttempts = 6;
    let llmErr = 'Unknown error';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const llmRes = await fetch(`${apiBase}/agents/${encodeURIComponent(agentName)}/llm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: selectedProvider.id, model: resolvedModel }),
        });
        const llmData: { success?: boolean; error?: string } = await llmRes.json();

        if (llmData.success) {
          llmErr = '';
          break;
        }

        llmErr = llmData.error || 'Unable to set provider.';
        if (attempt < maxAttempts) {
          await sleep(attempt * 300);
        }
      } catch (err) {
        llmErr = String(err);
        if (attempt < maxAttempts) {
          await sleep(attempt * 300);
        }
      }
    }

    if (llmErr) {
      const msg = `Failed to apply provider: ${llmErr}`;
      if (!silent) setProviderStatus(msg);
      return { ok: false, message: msg };
    }

    if (providerApiKey.trim() && selectedProvider.vault_key) {
      try {
        const keyRes = await fetch(`${apiBase}/agents/${encodeURIComponent(agentName)}/vault`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: selectedProvider.vault_key, value: providerApiKey.trim() }),
        });
        const keyData: { success?: boolean; error?: string } = await keyRes.json();
        if (!keyData.success) {
          const msg = `Provider applied, but key save failed: ${keyData.error || 'unknown error'}`;
          if (!silent) setProviderStatus(msg);
          return { ok: false, message: msg };
        }
      } catch (err) {
        const msg = `Provider applied, but key save failed: ${String(err)}`;
        if (!silent) setProviderStatus(msg);
        return { ok: false, message: msg };
      }
    }

    const successMsg = `Provider ${selectedProvider.name} / ${resolvedModel} applied to '${agentName}'.`;
    if (!silent) setProviderStatus(successMsg);
    return { ok: true, message: successMsg };
  };

  const handleApplyProviderToActive = async () => {
    if (!activeAgent) {
      setProviderStatus('Select an active agent first, or create one below.');
      return;
    }

    setIsApplyingProvider(true);
    await applyProviderToAgent(activeAgent);
    setIsApplyingProvider(false);
  };

  const handleCreateAgent = async () => {
    const name = newNodeName.trim();
    if (!name) {
      setProvisionStatus('Agent name is required.');
      return;
    }

    setIsProvisioning(true);
    setProvisionStatus('Creating agent...');

    try {
      const res = await fetch(`${apiBase}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: newNodeDesc,
          runtime_type: newNodeRuntime,
          ...(newNodeRuntime === 'wasm' ? { image_profile: newNodeProfile } : {}),
        }),
      });
      const data: { success?: boolean; error?: string } = await res.json();

      if (!data.success) {
        setProvisionStatus(`Error: ${data.error || 'Could not create agent.'}`);
        return;
      }

      setAgents(prev => (prev.includes(name) ? prev : [...prev, name]));
      setActiveAgent(name);
      setProvisionStatus(`Agent '${name}' created. Next: set provider below.`);

      setNewNodeName('');
      setNewNodeDesc('');
      setNewNodeRuntime('native');
      setNewNodeProfile('base');
    } catch (err) {
      setProvisionStatus(`Network error: ${String(err)}`);
    } finally {
      setIsProvisioning(false);
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-shell">
        <div className="mb-4 border-b border-[#d1d5db] pb-3">
          <h2 className="text-lg font-semibold text-[#111827]">Setup & Agents</h2>
          <p className="text-sm text-[#64748b] mt-1">
            Simple flow: create agent first, then add provider to that agent.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
          <section className="rounded-lg border border-[#d1d5db] bg-white p-4 order-2 xl:order-2">
            <h3 className="text-sm font-semibold text-[#111827] mb-3">2. Add Provider To Agent</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#64748b] mb-1">Provider</label>
                <AppSelect
                  value={providerId}
                  onChange={e => {
                    const nextId = e.target.value;
                    setProviderId(nextId);
                    const nextProvider = providers.find(p => p.id === nextId);
                    setProviderModel(nextProvider?.default_model || nextProvider?.models[0]?.id || '');
                  }}
                >
                  <option value="">Select provider</option>
                  {providers.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </AppSelect>
              </div>

              <div>
                <label className="block text-xs text-[#64748b] mb-1">Model</label>
                {selectedProvider && selectedProvider.models.length > 0 ? (
                  <>
                    <AppSelect
                      value={providerModel}
                      onChange={e => setProviderModel(e.target.value)}
                    >
                      {selectedProvider.models.map(model => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                      <option value="__custom__">Custom model ID...</option>
                    </AppSelect>
                    {providerModel === '__custom__' && (
                      <input
                        type="text"
                        value={providerCustomModel}
                        onChange={e => setProviderCustomModel(e.target.value)}
                        className="mt-2 w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                        placeholder="Enter custom model id"
                      />
                    )}
                  </>
                ) : (
                  <input
                    type="text"
                    value={providerModel}
                    onChange={e => setProviderModel(e.target.value)}
                    className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                    placeholder="Model id"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs text-[#64748b] mb-1">API Key (optional)</label>
                <input
                  type="password"
                  value={providerApiKey}
                  onChange={e => setProviderApiKey(e.target.value)}
                  className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                  placeholder="Leave blank to keep existing key"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleApplyProviderToActive}
                  disabled={!activeAgent || !providerId || !resolvedModel || isApplyingProvider}
                  className="rounded-md border border-[#111827] bg-[#111827] text-white px-4 py-2 text-xs font-medium disabled:opacity-50"
                >
                  {isApplyingProvider ? 'Saving...' : 'Apply To Selected Agent'}
                </button>
                <span className="text-xs text-[#64748b]">
                  {activeAgent ? `Active: ${activeAgent}` : 'No active agent selected yet.'}
                </span>
              </div>

              {providerStatus && (
                <p className={`text-xs ${providerStatus.startsWith('Failed') ? 'text-red-600' : 'text-emerald-700'}`}>
                  {providerStatus}
                </p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[#d1d5db] bg-white p-4 order-1 xl:order-1">
            <h3 className="text-sm font-semibold text-[#111827] mb-3">1. Create Agent</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[#64748b] mb-1">Agent Name</label>
                <input
                  type="text"
                  value={newNodeName}
                  onChange={e => setNewNodeName(e.target.value)}
                  className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                  placeholder="e.g. personal-assistant"
                />
              </div>

              <div>
                <label className="block text-xs text-[#64748b] mb-1">Description</label>
                <input
                  type="text"
                  value={newNodeDesc}
                  onChange={e => setNewNodeDesc(e.target.value)}
                  className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
                  placeholder="What this agent should focus on"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#64748b] mb-1">Runtime</label>
                  <AppSelect
                    value={newNodeRuntime}
                    onChange={e => setNewNodeRuntime(e.target.value)}
                  >
                    <option value="native">Native</option>
                    <option value="wasm">WASM</option>
                  </AppSelect>
                </div>
                {newNodeRuntime === 'wasm' && (
                  <div>
                    <label className="block text-xs text-[#64748b] mb-1">WASM Profile</label>
                    <AppSelect
                      value={newNodeProfile}
                      onChange={e => setNewNodeProfile(e.target.value)}
                    >
                      <option value="base">Base</option>
                      <option value="networked">Networked</option>
                      <option value="full">Full</option>
                    </AppSelect>
                  </div>
                )}
              </div>

              {newNodeRuntime === 'wasm' && (
                <div className="text-xs text-[#64748b] border border-[#e5e7eb] rounded-md p-2 bg-[#f8fafc] flex items-center gap-2">
                  <Cpu size={12} />
                  Runs in a sandboxed WASM runtime.
                </div>
              )}

              <button
                onClick={handleCreateAgent}
                disabled={!newNodeName.trim() || isProvisioning}
                className="rounded-md border border-[#111827] bg-[#111827] text-white px-4 py-2 text-xs font-medium disabled:opacity-50"
              >
                {isProvisioning ? 'Creating...' : 'Create Agent'}
              </button>

              <p className="text-xs text-[#64748b]">
                After creation, choose this agent in the header and configure provider in step 2.
              </p>

              {provisionStatus && (
                <p className={`text-xs ${provisionStatus.startsWith('Error') ? 'text-red-600' : 'text-emerald-700'}`}>
                  {provisionStatus}
                </p>
              )}
            </div>
          </section>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#111827] mb-3">Current Agents</h3>
          {agents.length === 0 ? (
            <p className="text-sm text-[#64748b]">No agents yet. Create your first agent above.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {agents.map(agent => (
                <div key={agent} className="rounded-lg border border-[#d1d5db] bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-[#111827]">{agent}</div>
                      <div className="text-xs text-[#64748b]">{activeAgent === agent ? 'Active agent' : 'Ready'}</div>
                    </div>
                    <button
                      onClick={() => setActiveAgent(agent)}
                      className="text-xs rounded-md border border-[#2563eb] px-2 py-1 bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                    >
                      Select
                    </button>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`${apiBase}/agents/${agent}/restart`, { method: 'POST' });
                          const data: { success?: boolean; error?: string } = await res.json();
                          if (data.success) {
                            setProvisionStatus(`Agent '${agent}' restarted.`);
                            if (activeAgent === agent) {
                              setChatHistory([]);
                              setStreamMessages([]);
                              setOptimisticUserMsg(null);
                              sessionCursorRef.current = 0;
                              seenIdsRef.current = new Set();
                            }
                          } else {
                            setProvisionStatus(`Error: ${data.error || 'Restart failed.'}`);
                          }
                        } catch (err) {
                          setProvisionStatus(`Error: ${String(err)}`);
                        }
                      }}
                      className="text-xs rounded-md border border-[#facc15] bg-[#fef9c3] px-2 py-1 text-[#92400e]"
                    >
                      Restart
                    </button>
                    {agent !== 'default' && (
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete agent '${agent}'?`)) return;
                          try {
                            const res = await fetch(`${apiBase}/agents/${agent}`, { method: 'DELETE' });
                            const data: { success?: boolean; error?: string } = await res.json();
                            if (data.success) {
                              setAgents(prev => prev.filter(a => a !== agent));
                              if (activeAgent === agent) {
                                setActiveAgent(agents.includes('default') ? 'default' : null);
                              }
                              setProvisionStatus(`Agent '${agent}' removed.`);
                            } else {
                              setProvisionStatus(`Error: ${data.error || 'Remove failed.'}`);
                            }
                          } catch (err) {
                            setProvisionStatus(`Error: ${String(err)}`);
                          }
                        }}
                        className="text-xs rounded-md border border-[#fecaca] bg-[#fef2f2] px-2 py-1 text-[#b91c1c]"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

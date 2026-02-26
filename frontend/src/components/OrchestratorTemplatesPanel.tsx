import { useEffect, useMemo, useState } from 'react';
import type { OrchestratorTemplate } from '../types';

interface OrchestratorTemplatesPanelProps {
  apiBase: string;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
}

const defaultSpawnProfiles = JSON.stringify(
  [
    {
      role: 'builder',
      persona: 'implementation specialist',
      provider: 'openai',
      model: 'gpt-4o',
      runtime_type: 'native',
      image_profile: 'base',
    },
  ],
  null,
  2,
);

export function OrchestratorTemplatesPanel({
  apiBase,
  agents: _agents,
  activeAgent,
  setActiveAgent: _setActiveAgent,
}: OrchestratorTemplatesPanelProps) {
  const [templates, setTemplates] = useState<OrchestratorTemplate[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workerMode, setWorkerMode] = useState<'existing' | 'ephemeral' | 'mixed'>('mixed');
  const [maxParallelism, setMaxParallelism] = useState('');
  const [retryLimit, setRetryLimit] = useState('1');
  const [failurePolicy, setFailurePolicy] = useState<'auto_replan' | 'fail_fast' | 'best_effort'>('auto_replan');
  const [mergePolicy, setMergePolicy] = useState<'manual_approval' | 'auto_on_review_pass'>('manual_approval');
  const [spawnProfilesJson, setSpawnProfilesJson] = useState(defaultSpawnProfiles);

  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const statusTone = useMemo(() => {
    if (!status) return 'text-[#94a3b8]';
    if (status.startsWith('Error:')) return 'text-red-400';
    return 'text-emerald-400';
  }, [status]);

  const resetForm = () => {
    setEditingId(null);
    setTemplateId('');
    setName('');
    setDescription('');
    setWorkerMode('mixed');
    setMaxParallelism('');
    setRetryLimit('1');
    setFailurePolicy('auto_replan');
    setMergePolicy('manual_approval');
    setSpawnProfilesJson(defaultSpawnProfiles);
  };

  const refreshTemplates = async () => {
    if (!apiBase || !activeAgent) return;
    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/orchestrate/templates`);
      const data = await res.json();
      if (data.success) {
        setTemplates(data.templates || []);
      }
    } catch {
      setTemplates([]);
    }
  };

  useEffect(() => {
    refreshTemplates();
  }, [apiBase, activeAgent]);

  const saveTemplate = async () => {
    if (!activeAgent) return;

    setStatus(null);
    setIsSaving(true);

    let spawnProfiles;
    try {
      spawnProfiles = JSON.parse(spawnProfilesJson);
      if (!Array.isArray(spawnProfiles)) {
        setStatus('Error: spawn_profiles must be a JSON array.');
        return;
      }
    } catch (err) {
      setStatus(`Error: invalid spawn_profiles JSON: ${String(err)}`);
      return;
    } finally {
      setIsSaving(false);
    }

    const createPayload = {
      template_id: templateId.trim(),
      name: name.trim(),
      description: description.trim(),
      default_worker_mode: workerMode,
      default_max_parallelism: maxParallelism.trim() ? Number(maxParallelism.trim()) : undefined,
      default_retry_limit: retryLimit.trim() ? Number(retryLimit.trim()) : undefined,
      default_failure_policy: failurePolicy,
      default_merge_policy: mergePolicy,
      spawn_profiles: spawnProfiles,
    };

    if (!createPayload.template_id || !createPayload.name) {
      setStatus('Error: template_id and name are required.');
      return;
    }

    setIsSaving(true);
    try {
      const method = editingId ? 'PATCH' : 'POST';
      const url = editingId
        ? `${apiBase}/agents/${activeAgent}/orchestrate/templates/${encodeURIComponent(editingId)}`
        : `${apiBase}/agents/${activeAgent}/orchestrate/templates`;

      const payload = editingId
        ? {
            name: createPayload.name,
            description: createPayload.description,
            default_worker_mode: createPayload.default_worker_mode,
            default_max_parallelism: createPayload.default_max_parallelism,
            default_retry_limit: createPayload.default_retry_limit,
            default_failure_policy: createPayload.default_failure_policy,
            default_merge_policy: createPayload.default_merge_policy,
            spawn_profiles: createPayload.spawn_profiles,
          }
        : createPayload;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(editingId ? 'Template updated.' : 'Template created.');
        await refreshTemplates();
        if (!editingId) {
          resetForm();
        }
      } else {
        setStatus(`Error: ${data.error || 'save failed'}`);
      }
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const editTemplate = (template: OrchestratorTemplate) => {
    setEditingId(template.template_id);
    setTemplateId(template.template_id);
    setName(template.name);
    setDescription(template.description || '');
    setWorkerMode((template.default_worker_mode || 'mixed') as 'existing' | 'ephemeral' | 'mixed');
    setMaxParallelism(template.default_max_parallelism ? String(template.default_max_parallelism) : '');
    setRetryLimit(template.default_retry_limit ? String(template.default_retry_limit) : '1');
    setFailurePolicy((template.default_failure_policy || 'auto_replan') as 'auto_replan' | 'fail_fast' | 'best_effort');
    setMergePolicy((template.default_merge_policy || 'manual_approval') as 'manual_approval' | 'auto_on_review_pass');
    setSpawnProfilesJson(JSON.stringify(template.spawn_profiles || [], null, 2));
  };

  const deleteTemplate = async (id: string) => {
    if (!activeAgent) return;
    setStatus(null);
    setIsDeleting(id);

    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/orchestrate/templates/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setStatus('Template deleted.');
        await refreshTemplates();
        if (editingId === id) {
          resetForm();
        }
      } else {
        setStatus(`Error: ${data.error || 'delete failed'}`);
      }
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-shell">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">
            Templates - {activeAgent || 'No Agent'}
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={refreshTemplates}
              className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
            >
              Refresh
            </button>
            <button
              onClick={resetForm}
              className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
            >
              New
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="p-4 border border-[#1e304f] bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">
              {editingId ? `Edit ${editingId}` : 'Create Template'}
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Template ID</label>
                <input
                  type="text"
                  value={templateId}
                  onChange={e => setTemplateId(e.target.value)}
                  disabled={Boolean(editingId)}
                  className="w-full bg-[#090d14] border border-[#1e304f] disabled:opacity-60 focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="tpl-kanban"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Worker Mode</label>
                <select
                  value={workerMode}
                  onChange={e => setWorkerMode(e.target.value as 'existing' | 'ephemeral' | 'mixed')}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white"
                >
                  <option value="existing">existing</option>
                  <option value="ephemeral">ephemeral</option>
                  <option value="mixed">mixed</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Max Parallelism</label>
                <input
                  type="number"
                  value={maxParallelism}
                  onChange={e => setMaxParallelism(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Retry Limit</label>
                <input
                  type="number"
                  value={retryLimit}
                  onChange={e => setRetryLimit(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Failure Policy</label>
                <select
                  value={failurePolicy}
                  onChange={e => setFailurePolicy(e.target.value as 'auto_replan' | 'fail_fast' | 'best_effort')}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white"
                >
                  <option value="auto_replan">auto_replan</option>
                  <option value="fail_fast">fail_fast</option>
                  <option value="best_effort">best_effort</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Merge Policy</label>
                <select
                  value={mergePolicy}
                  onChange={e => setMergePolicy(e.target.value as 'manual_approval' | 'auto_on_review_pass')}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white"
                >
                  <option value="manual_approval">manual_approval</option>
                  <option value="auto_on_review_pass">auto_on_review_pass</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Spawn Profiles (JSON)</label>
                <textarea
                  value={spawnProfilesJson}
                  onChange={e => setSpawnProfilesJson(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono h-48 resize-none"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={saveTemplate}
                disabled={isSaving}
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
              >
                {isSaving ? 'Saving...' : editingId ? 'Update Template' : 'Create Template'}
              </button>
              {editingId && (
                <button
                  onClick={resetForm}
                  className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
                >
                  Cancel Edit
                </button>
              )}
              {status && <span className={`text-[10px] ${statusTone}`}>{status}</span>}
            </div>
          </section>

          <section className="p-4 border border-[#1e304f] bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">Saved Templates</h3>
            {templates.length === 0 ? (
              <div className="text-[#64748b] text-sm">No templates found for this agent.</div>
            ) : (
              <div className="space-y-3 max-h-[38rem] overflow-auto scroll-styled pr-1">
                {templates.map(template => (
                  <div key={template.template_id} className="border border-[#1e304f] bg-[#0d1522] p-3 rounded-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-white text-xs font-bold">{template.name}</div>
                        <div className="text-[10px] text-[#94a3b8] font-mono">{template.template_id}</div>
                        <div className="text-[11px] text-[#94a3b8] mt-1">{template.description || 'No description.'}</div>
                        <div className="text-[10px] text-[#64748b] mt-1">
                          mode={template.default_worker_mode || 'mixed'} · retry={template.default_retry_limit ?? 1} · profiles={template.spawn_profiles?.length || 0}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <button
                          onClick={() => editTemplate(template)}
                          className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[9px] uppercase tracking-widest px-3 py-1 font-bold"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteTemplate(template.template_id)}
                          disabled={isDeleting === template.template_id}
                          className="bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 disabled:opacity-50 text-red-400 text-[9px] uppercase tracking-widest px-3 py-1 font-bold"
                        >
                          {isDeleting === template.template_id ? 'Removing...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

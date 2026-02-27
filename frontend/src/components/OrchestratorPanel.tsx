import { useEffect, useMemo, useState } from 'react';
import type {
  OrchestratorConfig,
  OrchestratorEvent,
  OrchestratorJob,
  OrchestratorTask,
  OrchestratorTemplate,
  OrchestratorWorkerRun,
} from '../types';

/** Parse planner output into role -> task map. Format: ## role\n<task>\n\n## next\n<task> */
function parsePlannerTasks(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /^##\s*(\w+)\s*\n([\s\S]*?)(?=^##\s|\z)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const role = m[1].toLowerCase();
    const task = m[2].trim();
    if (role && task) map.set(role, task);
  }
  return map;
}

/** Extract role from task_prompt (format "role :: prompt") */
function roleFromTaskPrompt(taskPrompt: string): string {
  const idx = taskPrompt.indexOf(' :: ');
  if (idx === -1) return '';
  return taskPrompt.slice(0, idx).trim().toLowerCase();
}

type ChecklistItem = { role: string; task: string; status: 'pending' | 'running' | 'succeeded' | 'failed' };

function buildChecklist(workers: OrchestratorWorkerRun[]): ChecklistItem[] {
  const planner = workers.find(w => roleFromTaskPrompt(w.task_prompt || '') === 'planner');
  const planText = planner?.output || planner?.error || '';
  const tasksByRole = parsePlannerTasks(planText);

  const workerByRole = new Map<string, OrchestratorWorkerRun>();
  for (const w of workers) {
    const r = roleFromTaskPrompt(w.task_prompt || '');
    if (r && r !== 'planner') workerByRole.set(r, w);
  }

  if (tasksByRole.size > 0) {
    return [...tasksByRole.entries()].map(([role, task]) => {
      const w = workerByRole.get(role);
      const status = !w
        ? 'pending'
        : w.status === 'succeeded'
          ? 'succeeded'
          : w.status === 'failed'
            ? 'failed'
            : 'running';
      return { role, task, status };
    });
  }

  return [...workerByRole.entries()].map(([role, w]) => ({
    role,
    task: w.task_prompt?.replace(/^[^:]*\s*::\s*/, '').slice(0, 120) || '—',
    status: (w.status === 'succeeded' ? 'succeeded' : w.status === 'failed' ? 'failed' : 'running') as ChecklistItem['status'],
  }));
}

interface OrchestratorPanelProps {
  apiBase: string;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
}

const defaultConfig: OrchestratorConfig = {
  default_template_id: '',
  default_worker_mode: 'mixed',
  default_max_parallelism: undefined,
  default_retry_limit: 1,
  default_failure_policy: 'auto_replan',
  default_merge_policy: 'manual_approval',
  parallelism_warn_threshold: 5,
};

export function OrchestratorPanel({
  apiBase,
  agents: _agents,
  activeAgent,
  setActiveAgent: _setActiveAgent,
}: OrchestratorPanelProps) {
  const [config, setConfig] = useState<OrchestratorConfig>(defaultConfig);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [workerMode, setWorkerMode] = useState<'existing' | 'ephemeral' | 'mixed'>('mixed');
  const [templateId, setTemplateId] = useState('');
  const [existingAgentsCsv, setExistingAgentsCsv] = useState('');
  const [ephemeralCount, setEphemeralCount] = useState('1');
  const [maxParallelism, setMaxParallelism] = useState('');
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);

  const [monitoredJobId, setMonitoredJobId] = useState<string>('');
  const [job, setJob] = useState<OrchestratorJob | null>(null);
  const [templates, setTemplates] = useState<OrchestratorTemplate[]>([]);
  const [workers, setWorkers] = useState<OrchestratorWorkerRun[]>([]);
  const [tasks, setTasks] = useState<OrchestratorTask[]>([]);
  const [events, setEvents] = useState<OrchestratorEvent[]>([]);
  const [streamMessages, setStreamMessages] = useState<string[]>([]);

  const tone = useMemo(() => {
    if (!jobStatus) return 'text-[#94a3b8]';
    if (jobStatus.includes('Error:')) return 'text-red-400';
    if (jobStatus.includes('Warning:')) return 'text-amber-400';
    return 'text-emerald-400';
  }, [jobStatus]);

  const loadConfig = async () => {
    if (!apiBase || !activeAgent) return;
    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/orchestrate/config`);
      const data = await res.json();
      if (data.success && data.config) {
        setConfig({ ...defaultConfig, ...data.config });
      }
    } catch {
      setConfig(defaultConfig);
    }
  };

  useEffect(() => {
    loadConfig();
  }, [apiBase, activeAgent]);

  const loadTemplates = async () => {
    if (!apiBase || !activeAgent) return;
    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/orchestrate/templates`);
      const data = await res.json();
      if (data.success) setTemplates(data.templates || []);
    } catch {
      setTemplates([]);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [apiBase, activeAgent]);

  const isJobActive = useMemo(
    () =>
      job &&
      !['completed', 'failed', 'canceled'].includes((job.status || '').toLowerCase()),
    [job]
  );

  const checklist = useMemo(() => buildChecklist(workers), [workers]);

  useEffect(() => {
    if (!monitoredJobId.trim() || !activeAgent || !apiBase) return;
    if (job && !isJobActive) return;

    const poll = () => refreshJob(monitoredJobId.trim());
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [monitoredJobId, activeAgent, apiBase, isJobActive]);

  const saveConfig = async () => {
    if (!activeAgent) return;
    setConfigStatus(null);
    setIsSavingConfig(true);

    const payload = {
      ...config,
      default_template_id: config.default_template_id?.trim() || null,
      default_max_parallelism:
        config.default_max_parallelism === null || config.default_max_parallelism === undefined
          ? null
          : Number(config.default_max_parallelism),
      default_retry_limit: Number(config.default_retry_limit || 1),
      parallelism_warn_threshold: Number(config.parallelism_warn_threshold || 5),
    };

    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/orchestrate/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setConfigStatus('Configuration saved.');
      } else {
        setConfigStatus(`Error: ${data.error || 'save failed'}`);
      }
    } catch (err) {
      setConfigStatus(`Error: ${String(err)}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const refreshJob = async (jobId: string) => {
    if (!activeAgent || !jobId) return;

    try {
      const [jobRes, workersRes, tasksRes, eventsRes] = await Promise.all([
        fetch(`${apiBase}/agents/${activeAgent}/orchestrate/jobs/${jobId}`),
        fetch(`${apiBase}/agents/${activeAgent}/orchestrate/jobs/${jobId}/workers`),
        fetch(`${apiBase}/agents/${activeAgent}/orchestrate/jobs/${jobId}/tasks`),
        fetch(`${apiBase}/agents/${activeAgent}/orchestrate/jobs/${jobId}/events`),
      ]);

      const jobData = await jobRes.json();
      const workersData = await workersRes.json();
      const tasksData = await tasksRes.json();
      const eventsData = await eventsRes.json();

      setJob(jobData.job || null);
      setWorkers(workersData.workers || []);
      setTasks(tasksData.tasks || []);
      setEvents(eventsData.events || []);
    } catch {
      setJob(null);
      setWorkers([]);
      setTasks([]);
      setEvents([]);
    }
  };

  const streamJob = async (jobId: string) => {
    if (!activeAgent || !jobId) return;

    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/orchestrate/jobs/${jobId}/stream`);
      const text = await res.text();
      const lines = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => line.startsWith('data:'))
        .map(line => line.replace(/^data:\s*/, ''));

      const parsed: string[] = [];
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.type === 'advisory') {
            parsed.push(`[advisory] ${event.text || 'advisory'}`);
          } else if (event.type === 'done') {
            parsed.push('[done] orchestration finished');
          } else {
            parsed.push(JSON.stringify(event));
          }
        } catch {
          parsed.push(line);
        }
      }
      setStreamMessages(parsed);
    } catch (err) {
      setStreamMessages([`stream error: ${String(err)}`]);
    }
  };

  const launchJob = async () => {
    if (!activeAgent || !prompt.trim()) return;
    setIsLaunching(true);
    setJobStatus(null);
    setStreamMessages([]);

    const existingAgents = existingAgentsCsv
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      prompt: prompt.trim(),
      worker_mode: workerMode,
    };
    if (templateId.trim()) payload.template_id = templateId.trim();
    if (existingAgents.length > 0) payload.existing_agents = existingAgents;
    if (ephemeralCount.trim()) payload.ephemeral = { count: Number(ephemeralCount.trim() || '0') };
    if (maxParallelism.trim()) payload.max_parallelism = Number(maxParallelism.trim() || '0');

    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/orchestrate/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
        setJobStatus(`Job started: ${data.job_id}`);
      } else {
        setJobStatus(`Error: ${data.error || 'job failed'}`);
      }

      if (data.job_id) {
        setMonitoredJobId(data.job_id);
        await refreshJob(data.job_id);
        await streamJob(data.job_id);
      }
    } catch (err) {
      setJobStatus(`Error: ${String(err)}`);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div className="panel-page">
      <div className="panel-shell">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">
            Orchestrator - {activeAgent || 'No Agent'}
          </h2>
          <button
            onClick={() => {
              loadConfig();
              loadTemplates();
            }}
            className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="p-4 border border-[#1e304f] bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">
              Agent Config
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Default Template</label>
                <input
                  type="text"
                  value={config.default_template_id || ''}
                  onChange={e => setConfig(prev => ({ ...prev, default_template_id: e.target.value }))}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="tpl-kanban"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Worker Mode</label>
                <select
                  value={config.default_worker_mode}
                  onChange={e => setConfig(prev => ({ ...prev, default_worker_mode: e.target.value as OrchestratorConfig['default_worker_mode'] }))}
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
                  value={config.default_max_parallelism ?? ''}
                  onChange={e => setConfig(prev => ({ ...prev, default_max_parallelism: e.target.value ? Number(e.target.value) : undefined }))}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="optional"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Retry Limit</label>
                <input
                  type="number"
                  value={config.default_retry_limit}
                  onChange={e => setConfig(prev => ({ ...prev, default_retry_limit: Number(e.target.value || '1') }))}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Failure Policy</label>
                <select
                  value={config.default_failure_policy}
                  onChange={e => setConfig(prev => ({ ...prev, default_failure_policy: e.target.value as OrchestratorConfig['default_failure_policy'] }))}
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
                  value={config.default_merge_policy}
                  onChange={e => setConfig(prev => ({ ...prev, default_merge_policy: e.target.value as OrchestratorConfig['default_merge_policy'] }))}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white"
                >
                  <option value="manual_approval">manual_approval</option>
                  <option value="auto_on_review_pass">auto_on_review_pass</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Warn Threshold</label>
                <input
                  type="number"
                  value={config.parallelism_warn_threshold}
                  onChange={e => setConfig(prev => ({ ...prev, parallelism_warn_threshold: Number(e.target.value || '5') }))}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={saveConfig}
                disabled={isSavingConfig}
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
              >
                {isSavingConfig ? 'Saving...' : 'Save Config'}
              </button>
              {configStatus && <span className="text-[10px] text-[#94a3b8]">{configStatus}</span>}
            </div>
          </section>

          <section className="p-4 border border-[#1e304f] bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">Launch Job</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
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
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Template (optional)</label>
                <select
                  value={templateId}
                  onChange={e => setTemplateId(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white"
                >
                  <option value="">None</option>
                  {templates.map(t => (
                    <option key={t.template_id} value={t.template_id}>
                      {t.name} ({t.template_id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Existing Agents (csv)</label>
                <input
                  type="text"
                  value={existingAgentsCsv}
                  onChange={e => setExistingAgentsCsv(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="default,reviewer"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Ephemeral Count</label>
                <input
                  type="number"
                  value={ephemeralCount}
                  onChange={e => setEphemeralCount(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Max Parallelism (optional)</label>
                <input
                  type="number"
                  value={maxParallelism}
                  onChange={e => setMaxParallelism(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono h-24 resize-none"
                  placeholder="Describe the larger job for ReActOr"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={launchJob}
                disabled={isLaunching || !prompt.trim()}
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
              >
                {isLaunching ? 'Launching...' : 'Start Job'}
              </button>
              {jobStatus && <span className={`text-[10px] ${tone}`}>{jobStatus}</span>}
            </div>
          </section>
        </div>

        <section className="mt-4 p-4 border border-[#1e304f] bg-[#0b121f] rounded-sm">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest">Job Monitor</h3>
            <input
              type="text"
              value={monitoredJobId}
              onChange={e => setMonitoredJobId(e.target.value)}
              className="w-80 max-w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
              placeholder="job_id"
            />
            <button
              onClick={() => {
                if (!monitoredJobId.trim()) return;
                refreshJob(monitoredJobId.trim());
                streamJob(monitoredJobId.trim());
              }}
              className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
            >
              Monitor
            </button>
          </div>

          {/* Task Board (structured task graph) */}
          {tasks.length > 0 && (
            <div className="border border-[#1e304f] bg-[#0d1522] p-3 rounded-sm mb-4">
              <div className="text-[#00aaff] uppercase tracking-widest text-[10px] mb-3">Task Board</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                {(['pending', 'in_progress', 'succeeded', 'failed'] as const).map(status => {
                  const statusTasks = tasks.filter(t => t.status === status);
                  const label = status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1);
                  const color = status === 'succeeded' ? 'text-emerald-400' : status === 'failed' ? 'text-red-400' : status === 'in_progress' ? 'text-amber-400' : 'text-[#64748b]';
                  return (
                    <div key={status}>
                      <div className={`${color} uppercase tracking-widest mb-2 font-bold`}>{label} ({statusTasks.length})</div>
                      <div className="space-y-1.5">
                        {statusTasks.map(task => (
                          <div key={task.task_id} className="border border-[#1e304f] bg-[#0a0f1a] p-2 rounded-sm">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-mono ${
                                task.role === 'builder' ? 'bg-blue-900/40 text-blue-300' :
                                task.role === 'checker' ? 'bg-purple-900/40 text-purple-300' :
                                task.role === 'merger' ? 'bg-green-900/40 text-green-300' :
                                'bg-gray-800 text-gray-400'
                              }`}>{task.role}</span>
                            </div>
                            <div className="text-[#dbe7ff] font-semibold text-[11px] mb-0.5">{task.title}</div>
                            <div className="text-[#94a3b8] leading-tight break-words">{task.description.slice(0, 100)}{task.description.length > 100 ? '…' : ''}</div>
                            {task.worker_agent && (
                              <div className="text-[#64748b] mt-1 font-mono">{task.worker_agent}</div>
                            )}
                          </div>
                        ))}
                        {statusTasks.length === 0 && <div className="text-[#3a4a63] italic">None</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 text-[11px]">
            <div className="border border-[#1e304f] bg-[#0d1522] p-3 rounded-sm">
              <div className="text-[#00aaff] uppercase tracking-widest text-[10px] mb-2">Checklist</div>
              {job ? (
                <div className="space-y-2 max-h-64 overflow-auto scroll-styled">
                  {checklist.length === 0 ? (
                    <div className="text-[#64748b]">
                      {workers.length === 0 ? 'Waiting for planner…' : 'No tasks yet.'}
                    </div>
                  ) : (
                    checklist.map((item, i) => (
                      <div
                        key={`${item.role}-${i}`}
                        className="border border-[#1e304f] p-2 rounded-sm"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className="shrink-0 mt-0.5"
                            title={item.status}
                            aria-label={item.status}
                          >
                            {item.status === 'succeeded' && (
                              <span className="text-emerald-400" role="img">✓</span>
                            )}
                            {item.status === 'failed' && (
                              <span className="text-red-400" role="img">✗</span>
                            )}
                            {item.status === 'running' && (
                              <span className="text-amber-400 animate-pulse" role="img">○</span>
                            )}
                            {item.status === 'pending' && (
                              <span className="text-[#64748b]" role="img">○</span>
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="text-[#00aaff] font-mono text-[10px]">{item.role}</div>
                            <div className="text-[#dbe7ff] text-[11px] break-words leading-tight mt-0.5">
                              {item.task}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="text-[#64748b]">No job loaded.</div>
              )}
            </div>

            <div className="border border-[#1e304f] bg-[#0d1522] p-3 rounded-sm">
              <div className="text-[#00aaff] uppercase tracking-widest text-[10px] mb-2">Workers</div>
              {workers.length === 0 ? (
                <div className="text-[#64748b]">No workers.</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-auto scroll-styled">
                  {workers.map(worker => (
                    <div key={worker.worker_run_id} className="border border-[#1e304f] p-2 rounded-sm">
                      <div className="text-[#dbe7ff] font-mono break-all">{worker.worker_run_id}</div>
                      <div className="text-[#94a3b8]">{worker.worker_agent} · {worker.worker_mode}</div>
                      <div className="text-[#94a3b8]">status: {worker.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-[#1e304f] bg-[#0d1522] p-3 rounded-sm">
              <div className="text-[#00aaff] uppercase tracking-widest text-[10px] mb-2">Stream / Events</div>
              <div className="space-y-1 max-h-48 overflow-auto scroll-styled">
                {streamMessages.map((line, idx) => (
                  <div key={`${line}-${idx}`} className="text-[#dbe7ff] font-mono break-words">{line}</div>
                ))}
                {events.map(event => (
                  <div key={event.id} className="text-[#94a3b8] font-mono break-words">
                    [{event.id}] {event.event_type}
                  </div>
                ))}
                {streamMessages.length === 0 && events.length === 0 && (
                  <div className="text-[#64748b]">No stream output.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import type { Schedule } from '../types';

interface SchedulesPanelProps {
  apiBase: string;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  schedules: Schedule[];
  setSchedules: React.Dispatch<React.SetStateAction<Schedule[]>>;
}

export function SchedulesPanel({
  apiBase,
  agents,
  activeAgent,
  setActiveAgent,
  schedules,
  setSchedules,
}: SchedulesPanelProps) {
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [newSchedName, setNewSchedName] = useState('');
  const [newSchedCron, setNewSchedCron] = useState('');
  const [newSchedPrompt, setNewSchedPrompt] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null);
  const [isScheduleSubmitting, setIsScheduleSubmitting] = useState(false);
  const [removingSchedule, setRemovingSchedule] = useState<string | null>(null);

  const refreshSchedules = () => {
    if (activeAgent && apiBase) {
      fetch(`${apiBase}/agents/${activeAgent}/schedules`)
        .then(res => res.json())
        .then(data => { if (data.success) setSchedules(data.schedules || []); });
    }
  };

  const normalizedNewName = newSchedName.trim().toLowerCase();
  const isUpdateAction = normalizedNewName.length > 0
    && schedules.some(s => s.name.trim().toLowerCase() === normalizedNewName);
  const scheduleStatusTone = scheduleStatus?.includes('Error:')
    ? 'text-red-400'
    : scheduleStatus?.includes('Warning:')
      ? 'text-amber-400'
      : 'text-emerald-400';

  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="bg-[#111927]/90 border border-[#1e304f] p-6 shadow-2xl backdrop-blur-sm h-full flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Schedules — {activeAgent || 'No Agent'}</h2>
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
              onClick={refreshSchedules}
              className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
            >
              Refresh
            </button>
            <button
              onClick={() => { setShowAddSchedule(!showAddSchedule); setScheduleStatus(null); }}
              className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all shadow-[0_0_12px_rgba(0,170,255,0.3)] font-bold"
            >
              {showAddSchedule ? 'Cancel' : '+ Add Schedule'}
            </button>
          </div>
        </div>

        {showAddSchedule && (
          <div className="mb-4 p-4 border border-[#00aaff]/30 bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">New Schedule</h3>
            <p className="text-[10px] text-[#94a3b8] mb-3">Using an existing name updates that schedule in-place.</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Name</label>
                <input
                  type="text" value={newSchedName} onChange={e => setNewSchedName(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="e.g. morning_weather"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Cron Expression</label>
                <input
                  type="text" value={newSchedCron} onChange={e => setNewSchedCron(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="e.g. 0 0 9 * * *"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Prompt</label>
              <textarea
                value={newSchedPrompt} onChange={e => setNewSchedPrompt(e.target.value)}
                className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono h-16 resize-none"
                placeholder="What should the agent do on this schedule?"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  const name = newSchedName.trim();
                  const cron = newSchedCron.trim();
                  const prompt = newSchedPrompt.trim();
                  if (!name || !cron || !prompt || !activeAgent) return;
                  setScheduleStatus(null);
                  setIsScheduleSubmitting(true);
                  try {
                    const res = await fetch(`${apiBase}/agents/${activeAgent}/schedules`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name, cron, prompt })
                    });
                    const data = await res.json();
                    if (data.success) {
                      const msg = data.message || (isUpdateAction ? 'Schedule updated' : 'Schedule added');
                      setScheduleStatus(data.warning ? `${msg}. Warning: ${data.warning}` : msg);
                      setNewSchedName(''); setNewSchedCron(''); setNewSchedPrompt('');
                      refreshSchedules();
                      if (!data.warning) {
                        setTimeout(() => { setShowAddSchedule(false); }, 1200);
                      }
                    } else {
                      setScheduleStatus(`Error: ${data.error}`);
                    }
                  } catch (err) {
                    setScheduleStatus(`Error: ${err}`);
                  } finally {
                    setIsScheduleSubmitting(false);
                  }
                }}
                disabled={!newSchedName.trim() || !newSchedCron.trim() || !newSchedPrompt.trim() || isScheduleSubmitting}
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
              >
                {isScheduleSubmitting ? 'Saving...' : isUpdateAction ? 'Update Schedule' : 'Create Schedule'}
              </button>
              {scheduleStatus && (
                <span className={`text-[10px] tracking-wide ${scheduleStatusTone}`}>
                  {scheduleStatus}
                </span>
              )}
            </div>
          </div>
        )}

        {schedules.length === 0 ? (
          <div className="flex items-center gap-4 text-sm text-[#64748b] p-4 border border-[#1e304f] bg-[#0d1522] rounded-sm">
            <CalendarClock size={18} className="text-[#385885]" /> No active schedules for this agent.
          </div>
        ) : (
          <div className="flex-grow overflow-y-auto scroll-styled flex flex-col gap-3">
            {schedules.map(sched => (
              <div key={sched.name} className="border border-[#1e304f] bg-[#0d1522] p-4 rounded-sm flex items-start justify-between gap-4 hover:border-[#385885] transition">
                <div className="flex-grow flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <CalendarClock size={14} className="text-[#00aaff] shrink-0" />
                    <span className="text-white text-xs font-bold tracking-wide">{sched.name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 border border-[#1e304f] text-[#64748b] bg-[#111927] rounded-sm font-mono">{sched.source}</span>
                  </div>
                  <div className="text-[11px] text-[#00aaff] font-mono">{sched.cron}</div>
                  <p className="text-[11px] text-[#94a3b8] leading-relaxed">{sched.prompt}</p>
                </div>
                <button
                  onClick={async () => {
                    if (!activeAgent) return;
                    setScheduleStatus(null);
                    setRemovingSchedule(sched.name);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/schedules/${encodeURIComponent(sched.name)}`, { method: 'DELETE' });
                      const data = await res.json();
                      if (data.success) {
                        refreshSchedules();
                        const msg = data.message || `Schedule '${sched.name}' removed`;
                        setScheduleStatus(data.warning ? `${msg}. Warning: ${data.warning}` : msg);
                      } else {
                        setScheduleStatus(`Error: ${data.error}`);
                      }
                    } catch (err) {
                      setScheduleStatus(`Error: ${err}`);
                    } finally {
                      setRemovingSchedule(null);
                    }
                  }}
                  disabled={removingSchedule === sched.name}
                  className="shrink-0 bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 disabled:opacity-50 text-red-400 text-[9px] uppercase tracking-widest px-3 py-1 font-bold transition-all"
                >
                  {removingSchedule === sched.name ? 'Removing...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

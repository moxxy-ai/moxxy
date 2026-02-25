import { Zap } from 'lucide-react';
import type { Skill } from '../types';

interface SkillsManagerProps {
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  skills: Skill[];
}

export function SkillsManager({ agents: _agents, activeAgent, setActiveAgent: _setActiveAgent, skills }: SkillsManagerProps) {
  return (
    <div className="panel-page">
      <div className="panel-shell">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Skills Vault - {activeAgent || 'No Agent'}</h2>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-[#64748b] uppercase tracking-widest">{skills.length} loaded</span>
          </div>
        </div>
        {skills.length === 0 ? (
          <div className="flex items-center gap-4 text-sm text-[#64748b] p-4 border border-[#1e304f] bg-[#0d1522] rounded-sm">
            <Zap size={18} className="text-[#385885]" /> No skills loaded for this agent.
          </div>
        ) : (
          <div className="flex-grow overflow-y-auto scroll-styled grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {skills.map(skill => (
              <div key={skill.name} className="border border-[#1e304f] bg-[#0d1522] p-4 rounded-sm flex flex-col gap-2 hover:border-[#385885] transition">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <Zap size={14} className="text-[#00aaff] shrink-0" />
                    <span className="text-white text-xs font-bold tracking-wide">{skill.name}</span>
                  </div>
                  <span className="text-[9px] text-[#64748b] font-mono">{skill.version}</span>
                </div>
                <p className="text-[11px] text-[#94a3b8] leading-relaxed">{skill.description}</p>
                <div className="flex gap-2 flex-wrap mt-1">
                  {skill.needs_network && <span className="text-[9px] px-1.5 py-0.5 border border-[#00aaff]/30 text-[#00aaff] bg-[#00aaff]/5 rounded-sm uppercase tracking-widest">Network</span>}
                  {skill.needs_fs_read && <span className="text-[9px] px-1.5 py-0.5 border border-emerald-400/30 text-emerald-400 bg-emerald-400/5 rounded-sm uppercase tracking-widest">FS Read</span>}
                  {skill.needs_fs_write && <span className="text-[9px] px-1.5 py-0.5 border border-amber-400/30 text-amber-400 bg-amber-400/5 rounded-sm uppercase tracking-widest">FS Write</span>}
                  {skill.needs_env && <span className="text-[9px] px-1.5 py-0.5 border border-red-400/30 text-red-400 bg-red-400/5 rounded-sm uppercase tracking-widest">Env</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

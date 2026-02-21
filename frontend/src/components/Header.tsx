import { Network, Clock, Activity } from 'lucide-react';

interface HeaderProps {
  now: Date;
  agentCount: number;
}

export function Header({ now, agentCount }: HeaderProps) {
  const formatUTC = (date: Date) => {
    return date.toISOString().split('T')[1].substring(0, 8) + 'h';
  };

  return (
    <header className="h-12 border-b border-[#1c2e4a] flex items-center justify-between px-6 bg-[#0f172a] shrink-0 z-20 shadow-md">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-slate-100 tracking-wide flex items-center gap-2">
          <Network size={16} className="text-[#00aaff]"/>
          MOXXY.AI <span className="text-[#64748b] font-normal">MISSION DASHBOARD</span>
        </h1>
      </div>
      <div className="flex items-center gap-6 text-[11px] font-mono text-slate-400">
        <div className="flex items-center gap-2 border-r border-[#1c2e4a] pr-6">
          <Clock size={12} className="text-[#00aaff]" />
          <span>UTC Time <br/><span className="text-white text-[12px]">{formatUTC(now)}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-[#00aaff]" />
          <span>Active Nodes <br/><span className="text-white text-[12px]">{agentCount}</span></span>
        </div>
      </div>
    </header>
  );
}

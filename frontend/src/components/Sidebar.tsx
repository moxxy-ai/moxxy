import { Network, Terminal, Database, Cpu, Radio, CalendarClock, Key, Settings } from 'lucide-react';
import type { TabId } from '../types';

interface SidebarProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

const NAV_ITEMS: { id: TabId; icon: typeof Network; label: string }[] = [
  { id: 'Overview', icon: Network, label: 'Swarm Overview' },
  { id: 'Interface', icon: Terminal, label: 'Agent Interface' },
  { id: 'Memory', icon: Database, label: 'Memory Bank' },
  { id: 'Skills', icon: Cpu, label: 'Skills Vault' },
  { id: 'Channels', icon: Radio, label: 'Channels' },
  { id: 'Schedules', icon: CalendarClock, label: 'Schedules' },
  { id: 'MCPServers', icon: Network, label: 'MCP Servers' },
  { id: 'Vault', icon: Key, label: 'Vault (Secrets)' },
  { id: 'Config', icon: Settings, label: 'Configuration' },
];

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  return (
    <aside className="w-48 border-r border-[#1c2e4a] bg-[#0c121e] flex flex-col shrink-0">
      <nav className="flex-grow pt-4 space-y-0.5">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-6 py-3.5 text-xs transition-colors ${
              activeTab === item.id
                ? 'bg-[#15233c] text-white border-l-[3px] border-[#00aaff]'
                : 'border-l-[3px] border-transparent text-[#64748b] hover:bg-[#111928] hover:text-[#cbd5e1]'
            }`}
          >
            <item.icon size={15} className={activeTab === item.id ? 'text-[#00aaff]' : 'opacity-70'} />
            <span className="tracking-wide">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="h-10 border-t border-[#1c2e4a] bg-[#0c121e] flex justify-around items-center px-2 pb-1">
        <button className="text-[9px] uppercase text-[#64748b] hover:text-white transition cursor-default">System</button>
        <button className="text-[9px] uppercase text-white bg-[#00aaff] px-2 py-0.5 shadow-[0_0_8px_rgba(0,170,255,0.4)] cursor-default">Online</button>
        <button className="text-[9px] uppercase text-[#64748b] hover:text-white transition cursor-default">Secure</button>
      </div>
    </aside>
  );
}

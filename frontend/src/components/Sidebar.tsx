import {
  Network,
  Terminal,
  Database,
  Cpu,
  Radio,
  CalendarClock,
  Key,
  Settings,
  Globe,
  Shield,
} from 'lucide-react';
import type { TabId } from '../types';

interface SidebarProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  activeAgent: string | null;
}

const NAV_ITEMS: { id: TabId; icon: typeof Network; label: string }[] = [
  { id: 'Overview', icon: Network, label: 'Overview' },
  { id: 'Interface', icon: Terminal, label: 'Chat' },
  { id: 'Memory', icon: Database, label: 'Memory' },
  { id: 'Skills', icon: Cpu, label: 'Skills' },
  { id: 'Channels', icon: Radio, label: 'Channels' },
  { id: 'Schedules', icon: CalendarClock, label: 'Schedules' },
  { id: 'Webhooks', icon: Globe, label: 'Webhooks' },
  { id: 'MCPServers', icon: Network, label: 'MCP' },
  { id: 'Vault', icon: Key, label: 'Vault' },
  { id: 'AccessTokens', icon: Shield, label: 'Access' },
  { id: 'Config', icon: Settings, label: 'Config' },
];

export function Sidebar({ activeTab, setActiveTab, activeAgent }: SidebarProps) {
  const visibleItems = activeAgent
    ? NAV_ITEMS
    : NAV_ITEMS.filter(item => item.id === 'Overview' || item.id === 'Config');

  return (
    <aside className="sidebar-shell">
      <nav className="flex gap-2 overflow-x-auto md:overflow-visible md:flex-wrap scroll-styled pb-1 md:pb-0">
        {visibleItems.map(item => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`shrink-0 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                isActive
                  ? 'gradient-bg border-transparent text-white glow-primary'
                  : 'bg-bg-card border-border text-text-muted hover:bg-bg-card-hover hover:text-text'
              }`}
            >
              <item.icon size={14} />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

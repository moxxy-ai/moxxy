import { useState } from 'react';
import { Network } from 'lucide-react';
import type { McpServer } from '../types';

interface McpServersPanelProps {
  apiBase: string;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  mcpServers: McpServer[];
  setMcpServers: React.Dispatch<React.SetStateAction<McpServer[]>>;
}

export function McpServersPanel({
  apiBase,
  agents,
  activeAgent,
  setActiveAgent,
  mcpServers,
  setMcpServers,
}: McpServersPanelProps) {
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpCommand, setNewMcpCommand] = useState('');
  const [newMcpArgs, setNewMcpArgs] = useState('');
  const [newMcpEnv, setNewMcpEnv] = useState('');
  const [mcpStatus, setMcpStatus] = useState<string | null>(null);
  const [isMcpSubmitting, setIsMcpSubmitting] = useState(false);
  const [removingMcp, setRemovingMcp] = useState<string | null>(null);

  const refreshMcpServers = () => {
    if (activeAgent && apiBase) {
      fetch(`${apiBase}/agents/${activeAgent}/mcp`)
        .then(res => res.json())
        .then(data => { if (data.success) setMcpServers(data.mcp_servers || []); });
    }
  };

  const mcpStatusTone = mcpStatus?.includes('Error:')
    ? 'text-red-400'
    : mcpStatus?.includes('Warning:')
      ? 'text-amber-400'
      : 'text-emerald-400';

  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="bg-[#111927]/90 border border-[#1e304f] p-6 shadow-2xl backdrop-blur-sm h-full flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">MCP Servers — {activeAgent || 'No Agent'}</h2>
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
              onClick={refreshMcpServers}
              className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
            >
              Refresh
            </button>
            <button
              onClick={() => { setShowAddMcp(!showAddMcp); setMcpStatus(null); }}
              className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all shadow-[0_0_12px_rgba(0,170,255,0.3)] font-bold"
            >
              {showAddMcp ? 'Cancel' : '+ Add Server'}
            </button>
          </div>
        </div>

        {showAddMcp && (
          <div className="mb-4 p-4 border border-[#00aaff]/30 bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-3">New MCP Server</h3>
            <p className="text-[10px] text-[#94a3b8] mb-3">Model Context Protocol (MCP) servers allow agents to safely consume tools over stdio.</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Server Name (ID)</label>
                <input
                  type="text" value={newMcpName} onChange={e => setNewMcpName(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="e.g. github_mcp"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Command (Executable)</label>
                <input
                  type="text" value={newMcpCommand} onChange={e => setNewMcpCommand(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="e.g. npx"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Args (Space Separated or JSON Array)</label>
                <input
                  type="text" value={newMcpArgs} onChange={e => setNewMcpArgs(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder='e.g. -y @modelcontextprotocol/server-postgres'
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">Environment Config (JSON)</label>
                <input
                  type="text" value={newMcpEnv} onChange={e => setNewMcpEnv(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder='e.g. {"DATABASE_URL": "postgres://..."}'
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  const name = newMcpName.trim();
                  const command = newMcpCommand.trim();
                  const args = newMcpArgs.trim();
                  const env = newMcpEnv.trim() || '{}';
                  if (!name || !command || !activeAgent) return;
                  setMcpStatus(null);
                  setIsMcpSubmitting(true);
                  try {
                    JSON.parse(env);
                    const res = await fetch(`${apiBase}/agents/${activeAgent}/mcp`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name, command, args, env })
                    });
                    const data = await res.json();
                    if (data.success) {
                      setMcpStatus(data.warning ? `${data.message}. Warning: ${data.warning}` : data.message);
                      setNewMcpName(''); setNewMcpCommand(''); setNewMcpArgs(''); setNewMcpEnv('');
                      refreshMcpServers();
                      if (!data.warning) {
                        setTimeout(() => { setShowAddMcp(false); }, 2000);
                      }
                    } else {
                      setMcpStatus(`Error: ${data.error}`);
                    }
                  } catch (err) {
                    setMcpStatus(`Error: Invalid JSON environment or network error. ${err}`);
                  } finally {
                    setIsMcpSubmitting(false);
                  }
                }}
                disabled={!newMcpName.trim() || !newMcpCommand.trim() || isMcpSubmitting}
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
              >
                {isMcpSubmitting ? 'Provisioning...' : 'Provision Server'}
              </button>
              {mcpStatus && (
                <span className={`text-[10px] tracking-wide ${mcpStatusTone}`}>
                  {mcpStatus}
                </span>
              )}
            </div>
          </div>
        )}

        {mcpServers.length === 0 ? (
          <div className="flex items-center gap-4 text-sm text-[#64748b] p-4 border border-[#1e304f] bg-[#0d1522] rounded-sm">
            <Network size={18} className="text-[#385885]" /> No MCP servers configured for this agent.
          </div>
        ) : (
          <div className="flex-grow overflow-y-auto scroll-styled grid grid-cols-1 xl:grid-cols-2 gap-3">
            {mcpServers.map(server => (
              <div key={server.name} className="border border-[#1e304f] bg-[#0d1522] p-4 rounded-sm flex flex-col gap-3 hover:border-[#385885] transition">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <Network size={14} className="text-[#00aaff] shrink-0" />
                    <span className="text-white text-xs font-bold tracking-wide flex items-center gap-2">
                      {server.name}
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-[#00aaff] font-mono leading-relaxed bg-[#0a101a] p-2 border border-[#1e304f]/50">
                  {server.command} {server.args}
                </div>
                <button
                  onClick={async () => {
                    if (!activeAgent) return;
                    setMcpStatus(null);
                    setRemovingMcp(server.name);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/mcp/${encodeURIComponent(server.name)}`, { method: 'DELETE' });
                      const data = await res.json();
                      if (data.success) {
                        refreshMcpServers();
                        setMcpStatus(data.message);
                      } else {
                        setMcpStatus(`Error: ${data.error}`);
                      }
                    } catch (err) {
                      setMcpStatus(`Error: ${err}`);
                    } finally {
                      setRemovingMcp(null);
                    }
                  }}
                  disabled={removingMcp === server.name}
                  className="self-start bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 disabled:opacity-50 text-red-400 text-[9px] uppercase tracking-widest px-3 py-1 font-bold transition-all mt-2"
                >
                  {removingMcp === server.name ? 'Removing...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

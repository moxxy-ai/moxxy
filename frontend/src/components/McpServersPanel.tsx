import { useState } from 'react';
import { Network, FileJson } from 'lucide-react';
import type { McpServer } from '../types';

type ParsedMcp = { name: string; command: string; args: string; env: string };

function parseMcpJson(raw: string): { ok: ParsedMcp[]; error: string | null } {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    const servers: ParsedMcp[] = [];

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === 'object' && 'name' in item && 'command' in item) {
          const o = item as Record<string, unknown>;
          servers.push({
            name: String(o.name ?? '').trim(),
            command: String(o.command ?? '').trim(),
            args: Array.isArray(o.args)
              ? (o.args as string[]).join(' ')
              : String(o.args ?? '').trim(),
            env: typeof o.env === 'object' && o.env !== null
              ? JSON.stringify(o.env)
              : String(o.env ?? '{}').trim() || '{}',
          });
        } else {
          return { ok: [], error: `Invalid array item: expected {name, command}` };
        }
      }
    } else if (parsed && typeof parsed === 'object' && 'mcpServers' in parsed) {
      const mcpServers = (parsed as { mcpServers?: Record<string, unknown> }).mcpServers;
      if (!mcpServers || typeof mcpServers !== 'object') {
        return { ok: [], error: 'mcpServers must be an object' };
      }
      for (const [name, spec] of Object.entries(mcpServers)) {
        if (!spec || typeof spec !== 'object') continue;
        const s = spec as Record<string, unknown>;
        const cmd = String(s.command ?? '').trim();
        if (!cmd) continue;
        const args = Array.isArray(s.args)
          ? (s.args as string[]).join(' ')
          : String(s.args ?? '').trim();
        const env =
          typeof s.env === 'object' && s.env !== null
            ? JSON.stringify(s.env)
            : String(s.env ?? '{}').trim() || '{}';
        servers.push({ name: name.trim() || `mcp_${servers.length}`, command: cmd, args, env });
      }
    } else if (parsed && typeof parsed === 'object' && 'name' in parsed && 'command' in parsed) {
      const o = parsed as Record<string, unknown>;
      servers.push({
        name: String(o.name ?? '').trim(),
        command: String(o.command ?? '').trim(),
        args: Array.isArray(o.args)
          ? (o.args as string[]).join(' ')
          : String(o.args ?? '').trim(),
        env: typeof o.env === 'object' && o.env !== null
          ? JSON.stringify(o.env)
          : String(o.env ?? '{}').trim() || '{}',
      });
    } else {
      return { ok: [], error: 'Expected: array of {name,command}, single {name,command}, or {mcpServers:{name:{command,args?,env}}}}' };
    }

    for (const s of servers) {
      if (!s.name) return { ok: [], error: 'Each server must have a non-empty name' };
      if (!s.command) return { ok: [], error: `Server "${s.name}" must have a command` };
      try {
        JSON.parse(s.env);
      } catch {
        return { ok: [], error: `Server "${s.name}": env must be valid JSON` };
      }
    }
    return { ok: servers, error: null };
  } catch (e) {
    return { ok: [], error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

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
  agents: _agents,
  activeAgent,
  setActiveAgent: _setActiveAgent,
  mcpServers,
  setMcpServers,
}: McpServersPanelProps) {
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);
  const [jsonPaste, setJsonPaste] = useState('');
  const [jsonValidation, setJsonValidation] = useState<{ ok: ParsedMcp[]; error: string | null } | null>(null);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpCommand, setNewMcpCommand] = useState('');
  const [newMcpArgs, setNewMcpArgs] = useState('');
  const [newMcpEnv, setNewMcpEnv] = useState('');
  const [mcpStatus, setMcpStatus] = useState<string | null>(null);
  const [isMcpSubmitting, setIsMcpSubmitting] = useState(false);
  const [removingMcp, setRemovingMcp] = useState<string | null>(null);

  const validateJson = () => {
    if (!jsonPaste.trim()) {
      setJsonValidation(null);
      return;
    }
    setJsonValidation(parseMcpJson(jsonPaste));
  };

  const saveParsedJson = async () => {
    const result = jsonPaste.trim() ? parseMcpJson(jsonPaste) : jsonValidation;
    if (!result || result.error || result.ok.length === 0) {
      if (jsonPaste.trim()) setJsonValidation(result);
      return;
    }
    if (!activeAgent || !apiBase) return;
    setMcpStatus(null);
    setIsMcpSubmitting(true);
    let success = 0;
    let failed: string[] = [];
    for (const server of result.ok) {
      try {
        JSON.parse(server.env);
        const res = await fetch(`${apiBase}/agents/${activeAgent}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: server.name,
            command: server.command,
            args: server.args,
            env: server.env || '{}',
          }),
        });
        const data = await res.json();
        if (data.success) {
          success += 1;
        } else {
          failed.push(`${server.name}: ${data.error}`);
        }
      } catch {
        failed.push(`${server.name}: invalid env JSON`);
      }
    }
    if (success > 0) refreshMcpServers();
    setMcpStatus(
      failed.length === 0
        ? `Imported ${success} server(s). Restart gateway to initialize.`
        : success > 0
          ? `Imported ${success}. Failed: ${failed.join('; ')}`
          : `Error: ${failed.join('; ')}`
    );
    if (failed.length === 0 && success > 0) {
      setShowJsonImport(false);
      setJsonPaste('');
      setJsonValidation(null);
    }
    setIsMcpSubmitting(false);
  };

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
    <div className="panel-page">
      <div className="panel-shell">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">MCP Servers - {activeAgent || 'No Agent'}</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={refreshMcpServers}
              className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold"
            >
              Refresh
            </button>
            <button
              onClick={() => { setShowAddMcp(!showAddMcp); setMcpStatus(null); setShowJsonImport(false); }}
              className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all shadow-[0_0_12px_rgba(0,170,255,0.3)] font-bold"
            >
              {showAddMcp ? 'Cancel' : '+ Add Server'}
            </button>
            <button
              onClick={() => { setShowJsonImport(!showJsonImport); setMcpStatus(null); setShowAddMcp(false); setJsonPaste(''); setJsonValidation(null); }}
              className="bg-[#0d1522] hover:bg-[#15233c] border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 transition-all font-bold flex items-center gap-2"
            >
              <FileJson size={12} />
              {showJsonImport ? 'Cancel' : 'Import JSON'}
            </button>
          </div>
        </div>

        {showJsonImport && (
          <div className="mb-4 p-4 border border-[#1e304f] bg-[#0b121f] rounded-sm">
            <h3 className="text-[#00aaff] text-[10px] uppercase tracking-widest mb-2 flex items-center gap-2">
              <FileJson size={14} />
              Paste JSON Config
            </h3>
            <p className="text-[10px] text-[#94a3b8] mb-3">
              Supports: single <code className="text-[#64748b]">&#123;name, command, args?, env?&#125;</code>,
              array of servers, or Claude-style <code className="text-[#64748b]">&#123;mcpServers: &#123;name: &#123;command, args, env&#125;&#125;&#125;</code>
            </p>
            <textarea
              value={jsonPaste}
              onChange={e => { setJsonPaste(e.target.value); setJsonValidation(null); }}
              placeholder={'{"name":"exa","command":"npx","args":"-y @modelcontextprotocol/server-exa","env":"{}"}\nor\n{"mcpServers":{"exa":{"command":"npx","args":["-y","@modelcontextprotocol/server-exa"],"env":{}}}}'}
              className="w-full h-28 bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-2 text-xs text-white font-mono resize-y"
            />
            <div className="flex items-center gap-3 flex-wrap mt-2">
              <button
                onClick={validateJson}
                disabled={!jsonPaste.trim()}
                className="bg-[#0d1522] hover:bg-[#15233c] disabled:opacity-50 border border-[#1e304f] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold"
              >
                Validate
              </button>
              <button
                onClick={saveParsedJson}
                disabled={
                  isMcpSubmitting ||
                  !jsonPaste.trim() ||
                  !!jsonValidation?.error ||
                  (jsonValidation?.ok?.length === 0 && !!jsonValidation)
                }
                className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-6 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
              >
                {isMcpSubmitting ? 'Saving...' : 'Validate & Save'}
              </button>
              {jsonValidation && (
                <span className={`text-[10px] ${jsonValidation.error ? 'text-red-400' : 'text-emerald-400'}`}>
                  {jsonValidation.error
                    ? jsonValidation.error
                    : `Valid: ${jsonValidation.ok.length} server(s) ready to save`}
                </span>
              )}
            </div>
            {jsonValidation?.ok && jsonValidation.ok.length > 0 && !jsonValidation.error && (
              <div className="mt-2 text-[10px] text-[#94a3b8]">
                Preview: {jsonValidation.ok.map(s => `${s.name} (${s.command})`).join(', ')}
              </div>
            )}
          </div>
        )}

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

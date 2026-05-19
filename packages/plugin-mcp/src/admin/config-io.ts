import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { McpStoredConfig, McpStoredServer } from './types.js';

/**
 * User-level MCP server catalog persisted at ~/.moxxy/mcp.json. Mutated
 * by the admin tools; read at boot by @moxxy/cli setup to spin up
 * connection plugins. JSON (not yaml) for trivial parse/write — these
 * entries are programmatically managed, the user doesn't normally edit
 * them by hand.
 */
export function mcpConfigPath(): string {
  return path.join(os.homedir(), '.moxxy', 'mcp.json');
}

export async function readMcpConfig(): Promise<McpStoredConfig> {
  try {
    const raw = await fs.readFile(mcpConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as McpStoredConfig).servers)) {
      return parsed as McpStoredConfig;
    }
  } catch {
    // missing or malformed — treat as empty
  }
  return { servers: [] };
}

export async function writeMcpConfig(cfg: McpStoredConfig): Promise<void> {
  const target = mcpConfigPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Atomic-ish write: temp file + rename so a crash mid-write can't
  // leave a half-flushed JSON blob that fails to parse next boot.
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, target);
}

/**
 * Set a server's `disabled` flag in mcp.json. Used by both `moxxy mcp
 * enable/disable` (CLI) and the `/mcp` slash command (TUI) — those
 * paths bypass the model and write directly. Returns the updated entry,
 * or null if no server with that name exists.
 *
 * Runtime detach (when disabling) and lazy re-attach (when enabling)
 * are NOT performed here — callers in a live session need to call into
 * the admin plugin's runtime API for that.
 */
export async function setServerDisabled(name: string, disabled: boolean): Promise<McpStoredServer | null> {
  const cfg = await readMcpConfig();
  const idx = cfg.servers.findIndex((s) => s.name === name);
  if (idx < 0) return null;
  const updated: McpStoredServer = { ...cfg.servers[idx]!, disabled };
  const nextServers = [...cfg.servers];
  nextServers[idx] = updated;
  await writeMcpConfig({ servers: nextServers });
  return updated;
}

/**
 * Drop a server from the catalog by name. Returns true if anything was
 * removed. Does NOT touch a live session's tool registry.
 */
export async function removeServerFromConfig(name: string): Promise<boolean> {
  const cfg = await readMcpConfig();
  const before = cfg.servers.length;
  const next = cfg.servers.filter((s) => s.name !== name);
  if (next.length === before) return false;
  await writeMcpConfig({ servers: next });
  return true;
}

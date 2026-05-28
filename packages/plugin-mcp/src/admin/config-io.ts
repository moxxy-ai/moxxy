import { promises as fs } from 'node:fs';
import { createMutex, moxxyPath, writeFileAtomic } from '@moxxy/sdk';
import { mcpStoredConfigSchema } from './config-schema.js';
import type { McpStoredConfig, McpStoredServer } from './types.js';

/**
 * User-level MCP server catalog persisted at ~/.moxxy/mcp.json. Mutated
 * by the admin tools; read at boot by @moxxy/cli setup to spin up
 * connection plugins. JSON (not yaml) for trivial parse/write — these
 * entries are programmatically managed, the user doesn't normally edit
 * them by hand.
 */
export function mcpConfigPath(): string {
  return moxxyPath('mcp.json');
}

/**
 * Serializes the read-modify-write cycle of every config mutator so that
 * concurrent mcp_add_server / mcp_remove_server (or enable/disable) calls
 * can't interleave their read + write and clobber the file.
 */
const configMutex = createMutex();

export async function readMcpConfig(): Promise<McpStoredConfig> {
  try {
    const raw = await fs.readFile(mcpConfigPath(), 'utf8');
    const parsed = mcpStoredConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
    // Malformed shape — treat as empty rather than crashing. The bad file
    // is left in place so the user can inspect it.
  } catch {
    // missing or malformed JSON — treat as empty
  }
  return { servers: [] };
}

export async function writeMcpConfig(cfg: McpStoredConfig): Promise<void> {
  // Trailing newline preserved for editor-friendliness / clean diffs.
  await writeFileAtomic(mcpConfigPath(), JSON.stringify(cfg, null, 2) + '\n');
}

/**
 * Read-modify-write the catalog under the shared mutex. The mutator
 * receives the freshly-read config and returns the next one; it is read
 * and written as one critical section so concurrent admin mutators can't
 * interleave and clobber each other. Returns whatever the mutator returns
 * so callers can thread through derived values (e.g. the updated entry).
 *
 * Returning the same `cfg` object reference skips the write entirely — a
 * no-op mutation (e.g. removing a name that isn't present) leaves the file
 * untouched.
 */
export async function mutateMcpConfig<T>(
  fn: (cfg: McpStoredConfig) => { next: McpStoredConfig; result: T } | Promise<{ next: McpStoredConfig; result: T }>,
): Promise<T> {
  return configMutex.run(async () => {
    const cfg = await readMcpConfig();
    const { next, result } = await fn(cfg);
    if (next !== cfg) await writeMcpConfig(next);
    return result;
  });
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
  return configMutex.run(async () => {
    const cfg = await readMcpConfig();
    const idx = cfg.servers.findIndex((s) => s.name === name);
    if (idx < 0) return null;
    const updated: McpStoredServer = { ...cfg.servers[idx]!, disabled };
    const nextServers = [...cfg.servers];
    nextServers[idx] = updated;
    await writeMcpConfig({ servers: nextServers });
    return updated;
  });
}

/**
 * Drop a server from the catalog by name. Returns true if anything was
 * removed. Does NOT touch a live session's tool registry.
 */
export async function removeServerFromConfig(name: string): Promise<boolean> {
  return configMutex.run(async () => {
    const cfg = await readMcpConfig();
    const before = cfg.servers.length;
    const next = cfg.servers.filter((s) => s.name !== name);
    if (next.length === before) return false;
    await writeMcpConfig({ servers: next });
    return true;
  });
}

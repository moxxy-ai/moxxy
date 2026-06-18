import { promises as fs } from 'node:fs';
import { createMutex } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { mcpStoredConfigRootSchema, mcpStoredServerSchema } from './config-schema.js';
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
    const root = mcpStoredConfigRootSchema.safeParse(JSON.parse(raw));
    if (!root.success) {
      // The top-level shape is unusable (e.g. `servers` isn't an array) —
      // treat as empty rather than crashing. The bad file is left in place
      // so the user can inspect it.
      return { servers: [] };
    }
    // Parse each entry independently and KEEP the valid ones. A single
    // hand-edited bad row (e.g. a missing/empty `name`) must not strand every
    // other configured server from boot/list/enable/remove — drop only the
    // offending row. `.passthrough()` keeps each entry's opaque extras intact.
    const servers: unknown[] = [];
    for (const entry of root.data.servers) {
      const parsed = mcpStoredServerSchema.safeParse(entry);
      if (parsed.success) servers.push(parsed.data);
    }
    return { servers } as unknown as McpStoredConfig;
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
  return mutateMcpConfig((cfg) => {
    const idx = cfg.servers.findIndex((s) => s.name === name);
    // Unknown name → same reference skips the write (mutateMcpConfig no-op).
    if (idx < 0) return { next: cfg, result: null };
    const updated: McpStoredServer = { ...cfg.servers[idx]!, disabled };
    const nextServers = [...cfg.servers];
    nextServers[idx] = updated;
    return { next: { servers: nextServers }, result: updated };
  });
}

/**
 * Drop a server from the catalog by name. Returns true if anything was
 * removed. Does NOT touch a live session's tool registry.
 */
export async function removeServerFromConfig(name: string): Promise<boolean> {
  return mutateMcpConfig((cfg) => {
    const before = cfg.servers.length;
    const next = cfg.servers.filter((s) => s.name !== name);
    // Nothing matched → same reference skips the write (mutateMcpConfig no-op).
    if (next.length === before) return { next: cfg, result: false };
    return { next: { servers: next }, result: true };
  });
}

import type { Skill, ToolDef } from '@moxxy/sdk';
import type { McpClientLike, McpServerConfig, McpToolDescriptor } from '../types.js';
import type { McpSecretResolver } from './secrets.js';

/**
 * Minimal skill-registry shape the admin plugin needs to auto-register
 * a usage skill after `mcp_add_server`. Loose typing to keep this plugin
 * free of an explicit @moxxy/core import.
 */
export interface AdminSkillRegistryLike {
  register(skill: Skill): void;
  byName(name: string): Skill | undefined;
}

/**
 * Live runtime: live MCP clients keyed by server name plus the set of
 * tool names each one registered into the session. Lets us close +
 * unregister on `mcp_remove_server` and on shutdown without
 * rediscovering anything. Module-scoped so the admin plugin and the
 * shutdown hook share the same state; each Session that loads the
 * plugin gets its own map via the closure in `buildMcpAdminPlugin`.
 */
export interface McpRuntimeHandle {
  readonly client: McpClientLike;
  readonly toolNames: ReadonlyArray<string>;
}

/**
 * Tool-registry surface the admin plugin uses to hot-attach / detach
 * MCP tools. Matches the `ToolRegistry` in @moxxy/core but typed loosely
 * so we don't add an internal-dep on core from this plugin.
 */
export interface AdminToolRegistryLike {
  has(name: string): boolean;
  register(tool: ToolDef): void;
  unregister(name: string): void;
}

/**
 * On-disk catalog entry: connection config PLUS a cache of the tool
 * descriptors the server last advertised, plus an enable/disable flag.
 *
 * Defined as an intersection (not `extends`) so the McpServerConfig
 * discriminated union is preserved — `extends` would collapse it.
 */
export type McpStoredServer = McpServerConfig & {
  readonly cachedTools?: ReadonlyArray<McpToolDescriptor>;
  /** When true, the boot loader skips this entry — no lazy stubs are
   *  registered and tools stay invisible. Lets the user keep the
   *  connection config for later without paying for tool registration. */
  readonly disabled?: boolean;
};

export interface McpStoredConfig {
  readonly servers: ReadonlyArray<McpStoredServer>;
}

export interface BuildMcpAdminPluginOptions {
  /**
   * Live tool registry. When provided, `mcp_add_server` connects + wraps
   * the server immediately and registers its tools into this registry —
   * no restart needed. `mcp_remove_server` closes the client and
   * unregisters. Pass `null` for pure-config behavior (write-only).
   */
  readonly toolRegistry: AdminToolRegistryLike | null;
  /**
   * Skill registry + skills dir. When provided, `mcp_add_server`
   * auto-writes a deterministic usage skill (server-name + tool catalog)
   * to disk and registers it so `/skills` and the system-prompt index
   * surface the MCP server alongside hand-authored skills. The skill is
   * generated from descriptors directly — no model call. Pass `null` to
   * disable auto-skill creation.
   */
  readonly skillRegistry?: AdminSkillRegistryLike | null;
  readonly userSkillsDir?: string;
  /**
   * Resolves `${vault:NAME}` placeholders in server env/header values at
   * CONNECT time (every connect path: hot-attach, lazy attach, cache
   * refresh, mcp_test_server). Wired from setup with the vault's
   * `resolveString`; literal values pass through unchanged. The persisted
   * catalog always keeps the placeholder form, never the plaintext.
   */
  readonly secretResolver?: McpSecretResolver | null;
}

/**
 * Runtime control surface exposed alongside the admin Plugin. The TUI's
 * /mcp slash command and the CLI's `moxxy mcp` subcommand use this to
 * detach a server's live tools when disabling, or re-attach when
 * enabling, without going through the model.
 */
export interface McpAdminApi {
  /** Refresh + lazy-attach a server (used after enabling). */
  enableAndAttach(name: string): Promise<{ toolNames: ReadonlyArray<string> } | null>;
  /** Detach a server's live tools and close its client. */
  detach(name: string): Promise<boolean>;
  /**
   * One-shot snapshot of every server configured in ~/.moxxy/mcp.json,
   * joined with the runtime attach state. `enabled` reflects the persisted
   * config (`disabled !== true`); `connected` is true when the server's
   * tools are attached to the session (whether eagerly or via a lazy stub
   * — both states make tools callable from a user's perspective). Used
   * by the TUI status bar to show "mcp 2/3" style summaries.
   */
  listServers(): Promise<ReadonlyArray<McpServerStatus>>;
}

export interface McpServerStatus {
  readonly name: string;
  readonly enabled: boolean;
  readonly connected: boolean;
}

import { z } from '@moxxy/sdk';
import type { McpStoredConfig } from './types.js';

/**
 * Runtime shape guard for ~/.moxxy/mcp.json. Intentionally permissive:
 * the catalog is programmatically managed and carries fields the admin
 * tools care about (`name`, transport config) plus opaque extras
 * (`cachedTools`, future flags) that must survive a read/write round-trip
 * untouched — hence `.passthrough()` on each entry and on the root. We
 * validate the structural invariant the loader relies on (a non-empty
 * `name`) per entry.
 */
export const mcpStoredServerSchema = z
  .object({
    name: z.string().min(1),
  })
  .passthrough();

/**
 * Top-level guard only: `servers` must be an array. Each element is parsed
 * INDIVIDUALLY by `readMcpConfig` against `mcpStoredServerSchema` so one bad
 * row drops alone instead of stranding the whole catalog. Element type is
 * `unknown` here on purpose — per-entry validation happens at read time.
 */
export const mcpStoredConfigRootSchema = z
  .object({
    servers: z.array(z.unknown()),
  })
  .passthrough();

export const mcpStoredConfigSchema = z
  .object({
    servers: z.array(mcpStoredServerSchema),
  })
  .passthrough()
  // The structural guard above is looser than the McpStoredConfig type
  // (server transport fields are validated lazily at connect time), so
  // re-assert the nominal type on the parsed output.
  .transform((value) => value as unknown as McpStoredConfig);

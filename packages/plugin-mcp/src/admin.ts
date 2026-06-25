/**
 * Backward-compatibility façade. The real implementation lives in
 * `./admin/` as cohesive sub-modules; this file just re-exports the
 * symbols that consumers (and the package's own `src/index.ts`) import.
 */
export {
  buildMcpAdminPlugin,
  buildMcpAdminPluginWithApi,
  mcpAdminPlugin,
  mcpConfigPath,
  readMcpConfig,
  removeServerFromConfig,
  setServerDisabled,
  writeMcpConfig,
  resolveServerSecrets,
  type McpSecretResolver,
  type AdminSkillRegistryLike,
  type AdminToolRegistryLike,
  type BuildMcpAdminPluginOptions,
  type McpAdminApi,
  type McpRuntimeHandle,
  type McpServerStatus,
  type McpStoredConfig,
  type McpStoredServer,
} from './admin/index.js';

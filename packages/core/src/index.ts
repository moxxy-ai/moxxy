export { Session, type SessionOptions } from './session.js';
export { runTurn, collectTurn, type RunTurnOptions } from './run-turn.js';
export {
  setupAgent,
  type Agent,
  type SetupAgentOptions,
  type AgentPreset,
} from './setup-agent.js';
// Re-export the @moxxy/sdk types that appear in the setupAgent / Agent surface,
// so the programmatic API is fully typed from a single `@moxxy/core` import.
export type { MoxxyEvent, Plugin, ToolDef, PermissionResolver } from '@moxxy/sdk';
export { createSubagentSpawner, clearRetainedChildren, type SubagentRuntime } from './subagents.js';
// Runtime provider/mode/model/disabled persistence moved from
// ~/.moxxy/preferences.json into the unified `plugins:` manifest; the writers
// now live in @moxxy/config (setCategoryDefault/setProviderModel/…).
export {
  loadUsageStats,
  mergeUsageStats,
  clearUsageStats,
  usageStatsPath,
  type UsageStatsFile,
  type StoredModelUsage,
} from './usage-stats.js';
export {
  loadSkillUsage,
  mergeSkillUsage,
  skillsUsagePath,
  type SkillUsageFile,
  type SkillUsage,
  type SkillUsageDelta,
} from './skill-usage.js';
export { SkillRegistryImpl } from './registries/skills.js';
export {
  parseSkillFile,
  parseFrontmatter,
  discoverSkills,
  defaultUserSkillsDir,
  defaultProjectSkillsDir,
  synthesizeSkill,
  buildSynthesizeSkillPlugin,
  type SkillLoadOptions,
  type DiscoveredSkill,
  type SynthesizeOptions,
  type SynthesizedSkill,
} from './skills/index.js';
export { EventLog, type EventListener } from './events/log.js';
// newEventId + materializeEvent are module-private helpers used only by
// EventLog.append; not re-exported.
export { newTurnId, newSessionId } from './events/factory.js';
export { ToolRegistryImpl, type ToolRegistry } from './registries/tools.js';
export { ProviderRegistry } from './registries/providers.js';
export { ModeRegistry } from './registries/modes.js';
export { CompactorRegistry } from './registries/compactors.js';
export { CacheStrategyRegistry } from './registries/cache-strategies.js';
export { ViewRendererRegistry } from './registries/view-renderers.js';
export { defaultViewRenderer } from './view/default-renderer.js';
export { parseView, validateDoc, countNodes } from './view/parse.js';
export { TunnelProviderRegistry } from './registries/tunnel-providers.js';
export { localhostTunnel } from './tunnel/localhost.js';
export { ChannelRegistryImpl } from './registries/channels.js';
export { AgentRegistry } from './registries/agents.js';
export { CommandRegistry } from './registries/commands.js';
export { TranscriberRegistry } from './registries/transcribers.js';
export { SynthesizerRegistry } from './registries/synthesizers.js';
export { EmbedderRegistry } from './registries/embedders.js';
export { IsolatorRegistry as ContributedIsolatorRegistry } from './registries/isolators.js';
export { EventStoreRegistry } from './registries/event-stores.js';
export { ReflectorRegistry } from './registries/reflectors.js';
export { jsonlEventStore } from './sessions/jsonl-event-store.js';
export type {
  EventStoreDef,
  EventStoreSession,
  EventStoreScope,
  EventLogLike,
} from '@moxxy/sdk';
export { RequirementRegistry, type RequirementRegistryOptions } from './requirements.js';
export {
  SessionPersistence,
  defaultSessionsDir,
  readIndex as readSessionIndex,
  restoreEvents as restoreSessionEvents,
  readEventPage as readSessionEventPage,
  pageEvents,
  deleteSession,
  listSessionMetas,
  setSessionTitle,
  setSessionGroup,
  seedSessionMeta,
  SESSION_META_VERSION,
  SESSION_SOURCES,
  type SessionMeta,
  type SessionSource,
  type SessionPersistenceOpts,
  type EventPage,
} from './sessions/persistence.js';
export { isMoxxyEventShape } from './sessions/event-shape.js';
export {
  PluginHost,
  PluginRequirementError,
  type PluginLoader,
  type PluginSkipReason,
  type PluginSkipRecord,
  type PluginSkipSource,
  type RegisterStaticOptions,
} from './plugins/host.js';
export { HookDispatcherImpl } from './plugins/lifecycle.js';
export { discoverPlugins } from './plugins/discovery.js';
export { toposortPluginManifests, PluginCycleError } from './plugins/toposort.js';
export { readPackageMoxxyRequirements } from './plugins/package-requirements.js';
export { createPluginLoader, type JitiLoaderOptions } from './plugins/loader.js';
export {
  PermissionEngine,
  permissionPolicySchema,
  type PermissionPolicy,
  type PolicyRule,
} from './permissions/engine.js';
export {
  autoAllowResolver,
  denyByDefaultResolver,
  createCallbackResolver,
  createDeferredPermissionResolver,
  type DeferredPermissionResolver,
  type DeferredPermissionResolverOptions,
  type PermissionPromptHandler,
  createAllowListResolver,
} from './permissions/resolvers.js';
export { createLogger, silentLogger, type Logger, type LogLevel } from './logger.js';

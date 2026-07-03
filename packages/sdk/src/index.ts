export type {
  EventId,
  TurnId,
  ToolCallId,
  SessionId,
  PluginId,
  SkillId,
} from './ids.js';
export { asEventId, asTurnId, asToolCallId, asSessionId, asPluginId, asSkillId } from './ids.js';

export type {
  EventBase,
  EventSource,
  MoxxyEvent,
  MoxxyEventType,
  MoxxyEventOfType,
  EmittedEvent,
  UserPromptEvent,
  UserPromptAttachment,
  TriggerOrigin,
  AssistantChunkEvent,
  AssistantMessageEvent,
  ReasoningChunkEvent,
  ReasoningMessageEvent,
  ToolCallRequestedEvent,
  ToolCallApprovedEvent,
  ToolCallDeniedEvent,
  ToolResultEvent,
  SkillInvokedEvent,
  SkillCreatedEvent,
  PluginRegisteredEvent,
  PluginUnregisteredEvent,
  ModeIterationEvent,
  CompactionEvent,
  ElisionEvent,
  ProviderRequestEvent,
  ProviderResponseEvent,
  ErrorEvent,
  AbortEvent,
  PluginEvent,
} from './events.js';

export type { EventLogReader } from './log.js';

export type {
  RunTurnOptions,
  SessionLogReader,
  SessionLike,
  SessionInfo,
  ProviderInfo,
  ToolInfo,
  SkillInfo,
  CommandInfo,
  CredentialResolver,
  McpAdminView,
  McpServerStatusView,
  ProviderAdminView,
  ProviderConfigurePatch,
  WorkflowsView,
  WorkflowSummaryView,
  WorkflowRunView,
  WorkflowValidateView,
  WorkflowSaveView,
  PluginsAdminView,
  InstallablePluginView,
  LoadedPluginView,
  CategoryView,
  CategoryItemView,
  ProviderSetupView,
  ProviderConnectIo,
} from './session-like.js';

export type {
  ClientSession,
  ProvidersClientView,
  ModesClientView,
  ToolsClientView,
  CommandsClientView,
  SkillsClientView,
  AgentsClientView,
  TranscribersClientView,
  SynthesizersClientView,
  RequirementsClientView,
  PermissionsClientView,
} from './client-session.js';

export type {
  PermissionMode,
  PermissionDecision,
  PermissionRule,
  PendingToolCall,
  PermissionContext,
  PermissionResolver,
} from './permission.js';

export type {
  ToolContext,
  ToolDef,
  ToolCompactPresentation,
  BrokeredFs,
  BrokeredStat,
  BrokeredFetch,
  BrokeredFetchInit,
  BrokeredFetchResponse,
  BrokeredExec,
  BrokeredExecOpts,
  BrokeredExecResult,
} from './tool.js';

export type {
  FsCapability,
  NetCapability,
  CapabilitySpec,
  IsolationStrength,
  ToolIsolationSpec,
  IsolatedToolCall,
  Isolator,
  HandlerModuleRef,
} from './isolation.js';
export { ISOLATION_RANK, aggregateCapabilitySpecs } from './isolation.js';

export { FIRST_PARTY_PLUGIN_SCOPE, isFirstPartyPackage } from './first-party.js';

export type {
  SubagentSpec,
  SubagentResult,
  SubagentSpawner,
  SubagentContinueArgs,
} from './subagent.js';


export type {
  ContentBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderEvent,
  CacheHint,
  TokenUsage,
  ModelDescriptor,
  LLMProvider,
  ProviderDef,
  ProviderKeyValidation,
  ProviderVault,
  ProviderAuthContext,
  ProviderOAuthResult,
  ProviderOAuthStatus,
  ProviderAuthDescriptor,
} from './provider.js';
export {
  encodeLoginPrompt,
  decodeLoginPrompt,
  createLoginStreamScanner,
} from './provider-login-bridge.js';
export type { LoginPromptRequest, LoginStreamItem } from './provider-login-bridge.js';
export type { CacheStrategyDef, CacheStrategyContext } from './cache-strategy.js';
export type {
  DiffLine,
  DiffHunk,
  DiffRow,
  FileDiffDisplay,
  ToolDisplay,
  ToolDisplayResult,
} from './tool-display.js';
export {
  isToolDisplayResult,
  isToolDisplay,
  isFileDiffDisplay,
  fileDiffSummary,
  fileDiffVerb,
  diffGutterNo,
  toDiffRows,
} from './tool-display.js';
export type {
  ViewNode,
  ViewAction,
  ViewDoc,
  ViewParseError,
  ViewParseResult,
  AttrType,
  AttrSpec,
  ViewTagSpec,
  ViewRendererDef,
} from './view-renderer.js';
export { VIEW_PRIMITIVES, VIEW_COMPONENTS, DEFAULT_VIEW_TAGS, isSafeViewUrl, countNodes } from './view-renderer.js';
export type { TunnelProviderDef, TunnelHandle, TunnelOpenOptions } from './tunnel.js';
export type {
  EventStoreDef,
  EventStoreSession,
  EventStoreScope,
  EventLogLike,
  EventPage,
  SessionMeta,
  SessionSource,
} from './event-store.js';
export { SESSION_SOURCES } from './event-store.js';
export type {
  ReflectorDef,
  ReflectContext,
  ReflectionProposal,
} from './reflector.js';
// Node-runtime helpers (writeFileAtomic*, moxxyHome/moxxyPath,
// readRequestBody/bearerTokenMatches, channel-auth) are exported from the
// './server' subpath, NOT the main barrel — they statically reach node:*
// builtins and would break a browser/RN bundle. See ./server.ts.
export { isRetryableError, toFriendlyError, zodToJsonSchema, estimateTextTokens, type StopReason } from './provider-utils.js';
export type { WriteFileAtomicOptions } from './fs-utils.js';
export type { ChannelRunStatus } from './channel-status.js';
export type { CrossProcessFireLock, CrossProcessFireLockOptions } from './cross-process-lock.js';
export { createMutex, type Mutex } from './mutex.js';
export {
  createJsonFileStore,
  type JsonFileStore,
  type JsonFileStoreOptions,
} from './json-file-store.js';
export { assertNever } from './assert.js';
export { compareSemver, parseSemverCore } from './semver.js';
// readRequestBody/bearerTokenMatches (http-utils) and the channel-auth value
// helpers live on the './server' subpath — they reach node:http/crypto/fs/path.
export type { ChannelTokenOptions } from './channel-auth.js';
export {
  autoAllowResolver,
  denyByDefaultResolver,
  createCallbackResolver,
  createAllowListResolver,
  createDeferredPermissionResolver,
  evaluateToolRule,
  type CallbackResolverOptions,
  type PermissionPromptHandler,
  type DeferredPermissionResolver,
  type DeferredPermissionResolverOptions,
} from './resolvers.js';
export {
  MoxxyError,
  classifyHttpStatus,
  classifyNetworkError,
  type MoxxyErrorCode,
  type MoxxyErrorInit,
} from './errors.js';
// Shared retry primitives: a leak-safe, abort-aware sleep + the exponential
// back-off schedule. General-purpose — not mode-loop internals: the runner's
// connect retry and the desktop supervisor's restart wait use them too, so
// don't reimplement an ad-hoc `new Promise(setTimeout)` back-off elsewhere.
export { sleepWithAbort, nextBackoffMs } from './mode/abort-backoff.js';
export {
  collectProviderStream,
  runSingleShotTurn,
  projectMessagesFromLog,
  projectMessages,
  buildSystemPromptWithSkills,
  createStuckLoopDetector,
  stableHash,
  type CollectedToolUse,
  type StreamResult,
  type ProjectMessagesOptions,
  type ProjectedMessages,
  type StuckLoopDetector,
  type StuckSignal,
  type LoopGuardSettings,
} from './mode-helpers.js';
export {
  dispatchToolCall,
  executeToolUses,
  emitRequestsAndDetectStuck,
  type StuckLoopReport,
} from './tool-dispatch.js';

export type { TokenBudget, CompactContext, CompactorDef } from './compactor.js';
export {
  estimateContextTokens,
  runCompactionIfNeeded,
  runManualCompaction,
  resolveModelContext,
  isContextOverflowError,
  type ManualCompactionInput,
  type ManualCompactionResult,
} from './compactor-helpers.js';
export {
  runElisionIfNeeded,
  resolveElisionSettings,
  type ResolvedElisionSettings,
} from './elision-helpers.js';
export {
  computeElisionState,
  toolResultStub,
  conversationalStub,
  toolResultBytes,
  toolResultStubbed,
  conversationalStubbed,
  TINY_TURN_CHARS,
  type ElisionState,
} from './elision-state.js';
export {
  applyLazyTools,
  buildToolIndex,
  loadedToolNames,
  ALWAYS_ON_TOOLS,
  type GatedTools,
} from './tool-gating.js';

export {
  summarizeSessionTokens,
  summarizeSessionTokensFromEvents,
  summarizeTokensByModel,
  addModelTotals,
  usageEventFields,
  type SessionTokenSummary,
  type ModelUsageTotals,
} from './token-accounting.js';

export type { Skill, SkillDef, SkillFrontmatter, SkillScope, SkillSchedule } from './skill.js';

export type {
  Workflow,
  WorkflowStep,
  WorkflowLoopAction,
  WorkflowTrigger,
  WorkflowStepErrorMode,
  WorkflowLogicStepFormat,
  WorkflowInputSpec,
  WorkflowDelivery,
  WorkflowUi,
  WorkflowUiLayout,
  WorkflowUiLayoutNode,
  WorkflowUiViewport,
  WorkflowToolRunner,
  WorkflowLookup,
  WorkflowEventSubtype,
  WorkflowRunDeps,
  WorkflowStepStatus,
  WorkflowRunStatus,
  WorkflowStepResult,
  WorkflowRunResult,
  WorkflowExecutorDef,
} from './workflow.js';

export type { AgentDef } from './agent.js';

export type {
  CommandDef,
  CommandContext,
  CommandOutput,
  CommandHandlerResult,
} from './command.js';

export type {
  ToolRegistry,
  SkillRegistry,
  PluginHostHandle,
  ModeContext,
  ModeDef,
  ModeBadge,
  ModeSpecial,
  ElisionSettings,
  ApprovalResolver,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalOption,
} from './mode.js';

export type {
  AppContext,
  TurnContext,
  ToolCallContext,
  ToolResultContext,
  ToolCallVerdict,
  ToolCallRequest,
  LifecycleHooks,
  HookDispatcher,
} from './hooks.js';

export type { ServiceRegistry, NamedRegistry } from './services.js';

export type {
  PluginKind,
  PluginSpec,
  Plugin,
  PluginManifest,
  ResolvedPluginManifest,
} from './plugin.js';

export { startChannelWith, EXIT_AFTER_PAIR_FLAG, exitAfterPairRequested } from './channel.js';
export type {
  Channel,
  ChannelHandle,
  ChannelStartArgs,
  ChannelStartOptsBase,
  ChannelFactoryDeps,
  ChannelDef,
  ChannelConfigField,
  ChannelConfigDescriptor,
  ChannelConnectStep,
  ChannelAvailability,
  ChannelRegistry,
  ChannelSubcommand,
  ChannelSubcommandContext,
  ChannelCommandArgs,
} from './channel.js';
export type { EmbeddingProvider, EmbedderDef } from './embedding.js';
export { CachedEmbeddingProvider } from './embedding-cache.js';

export { defineSurface } from './surface.js';
export type {
  SurfaceKind,
  SurfaceDataMessage,
  SurfaceInputMessage,
  SurfaceSize,
  SurfaceInstance,
  SurfaceAvailability,
  SurfaceContext,
  SurfaceDef,
  SurfaceRegistry,
  SurfaceInfo,
  OpenSurfaceResult,
  SurfaceHost,
} from './surface.js';

export type {
  RequirementKind,
  RequirementState,
  MoxxyRequirement,
  RequirementIssue,
  RequirementCheck,
} from './requirements.js';

export type {
  Transcriber,
  TranscriberDef,
  TranscriptionResult,
  TranscriptionSegment,
  TranscribeOptions,
} from './transcriber.js';
export { MOXXY_PCM16_24KHZ_MIME } from './transcriber.js';

export type {
  Synthesizer,
  SynthesizerDef,
  SynthesizerCreateContext,
  SynthesisResult,
  SynthesizeOptions,
} from './synthesizer.js';

export interface PluginLoader {
  load(manifest: import('./plugin.js').ResolvedPluginManifest): Promise<import('./plugin.js').Plugin>;
}

export {
  definePlugin,
  defineTool,
  defineProvider,
  defineMode,
  defineCompactor,
  defineCacheStrategy,
  defineViewRenderer,
  defineTunnelProvider,
  defineChannel,
  definePermission,
  defineSkill,
  defineTranscriber,
  defineSynthesizer,
  defineEmbedder,
  defineCommand,
  defineAgent,
  defineWorkflowExecutor,
} from './define.js';

export { migrateModeName, isSelectableMode } from './mode.js';

export {
  skillFrontmatterSchema,
  pluginManifestSchema,
  moxxyPackageSchema,
  pluginSetupFieldSchema,
  pluginSetupSchema,
  requirementSchema,
  type SkillFrontmatterInput,
  type PluginManifestInput,
  type MoxxyPackageInput,
  type PluginSetupField,
  type PluginSetupSpec,
} from './schemas.js';

export {
  parseFrontmatterFile,
  parseFrontmatter,
  renderFrontmatter,
  type ParsedFrontmatter,
} from './frontmatter.js';

export {
  getInstallHint,
  type InstallHint,
  type InstallTarget,
} from './install-hints.js';

export { z } from 'zod';

/**
 * Shared IPC contract — every channel name and payload shape used
 * across the Electron main / preload / renderer boundary lives here.
 * The preload exposes `window.moxxy` whose surface is generated from
 * these types; the renderer uses `window.moxxy` exclusively (no raw
 * `electron.ipcRenderer.invoke` calls leak through).
 *
 * Keeping the contract behind ONE public surface means a new feature is one
 * shape addition + a main-process handler + a renderer call — no string typos
 * across three places. The shapes are SPLIT into per-domain sibling modules
 * (`connection.ts`, `settings.ts`, `desks.ts`, `chat.ts`, `app-update.ts`,
 * `mobile.ts`, … `commands.ts`/`events.ts` assemble the two big maps) so each
 * domain can be edited atomically; this barrel RE-EXPORTS every one so the
 * surface every consumer imports (`@moxxy/desktop-ipc-contract`) is unchanged.
 *
 * Design note (the "generic comms" story): this is *intentionally* a single
 * generic typed RPC over Electron's native `ipcRenderer.invoke` /
 * `ipcMain.handle` — `invoke<K>` / `subscribe<K>` are the only two transport
 * primitives, request/response correlation is Electron's, and validation is
 * centralized at one `handle()` choke point. We deliberately do NOT hand-roll a
 * bespoke RPC framework. The one piece that was missing — a uniform error
 * shape — is the {@link MoxxyIpcError} envelope below: every handler failure is
 * encoded with a stable `code` so the renderer branches on that instead of
 * string-matching English messages.
 */

import type {
  ApprovalRequest,
  ApprovalOption,
  PermissionMode,
  ModeBadge,
  SessionInfo,
  UserPromptAttachment,
} from '@moxxy/sdk';

export type { ApprovalRequest, ApprovalOption, PermissionMode, ModeBadge, UserPromptAttachment };
export type { SessionInfo };

// `validateIpcInput` / `ipcInputSchemas` are exposed via the
// `@moxxy/desktop-ipc-contract/validation` subpath (not re-exported here)
// so the contract types stay a leaf — validation depends on the types,
// not the other way around.

// ---------- Interactive ask (permission / approval prompts) ---------------
export { SESSION_INFO_REFRESH_EVENT } from './ask.js';
export type { AskRequest, AskResponse, WorkflowAsk } from './ask.js';

// ---------- Uniform error envelope ----------------------------------------
export { encodeIpcError, decodeIpcError } from './error-envelope.js';
export type { MoxxyIpcErrorCode, MoxxyIpcError } from './error-envelope.js';

// ---------- Connection lifecycle -------------------------------------------
export type { ConnectionPhase, ConnectionSnapshot } from './connection.js';

// ---------- Onboarding -----------------------------------------------------
export type { OnboardingStatus, NodeProbe } from './onboarding.js';

// ---------- Desktop preferences (first-run + auth state) -------------------
export type { ThemePreference, DesktopPrefs } from './prefs.js';

// ---------- Workflows ------------------------------------------------------
export type {
  WorkflowSummary,
  WorkflowRun,
  WorkflowValidate,
  WorkflowSave,
  WorkflowDetail,
} from './workflows.js';

// ---------- Scheduler -----------------------------------------------------
export type { ScheduleSource, ScheduleSummary, SchedulerDeleteResult } from './scheduler.js';

// ---------- Webhooks ------------------------------------------------------
export type { WebhookLastResult, WebhookSummary, WebhookDeleteResult } from './webhooks.js';

// ---------- Mobile gateway (WebSocket bridge) ------------------------------
export type { MobileGatewayStatus } from './mobile.js';

// ---------- Communication channels (Slack / Telegram on dedicated runners) -
export type {
  ChannelConfigField,
  ChannelDescriptor,
  ChannelRuntimeStatus,
  ChannelEntry,
} from './channels.js';

// ---------- Settings -------------------------------------------------------
export type {
  ProviderEntry,
  McpServerEntry,
  VaultEntryName,
  SkillFile,
  ReasoningEffort,
} from './settings.js';

// ---------- Desks ---------------------------------------------------------
export type { DeskSession, Desk, DesksOverview, SessionsOverview } from './desks.js';

// ---------- Chat -----------------------------------------------------------
export type { PromptAttachment, RunTurnArgs, RunTurnResult } from './chat.js';

// ---------- App / dashboard self-update ------------------------------------
export type {
  AppUpdateInfo,
  AppUpdateCheck,
  AppUpdateProgress,
  AppBootLogEntry,
  AppUpdateDiagnostics,
} from './app-update.js';

// ---------- Deep links (moxxy:// URLs) -------------------------------------
export type { DeepLinkPayload } from './deep-link.js';

// ---------- Desktop apps gallery (install lifecycle + anonymizer) ----------
export type {
  AppInstallState,
  AppInstallStatus,
  AppInstallProgress,
  AnonymizerParseResult,
} from './apps.js';

// ---------- Events the renderer subscribes to ------------------------------
export type { IpcEvents } from './events.js';

// ---------- Invokable commands (renderer → main) --------------------------
export type { IpcCommands, IpcCommandName, CollabRunSummary } from './commands.js';

// ---------- The remote / mobile trust surface -----------------------------
export { REMOTE_ALLOWED_COMMANDS } from './remote.js';

// ---------- Shape the preload exposes on `window.moxxy` -------------------
export type { SubscribeFn, InvokeFn, MoxxyApi } from './api.js';

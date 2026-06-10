/**
 * Shared IPC contract — every channel name and payload shape used
 * across the Electron main / preload / renderer boundary lives here.
 * The preload exposes `window.moxxy` whose surface is generated from
 * these types; the renderer uses `window.moxxy` exclusively (no raw
 * `electron.ipcRenderer.invoke` calls leak through).
 *
 * Keeping this in one file means a new feature is one shape addition
 * here + a main-process handler + a renderer call — no string typos
 * across three places.
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
  MoxxyEvent,
  SessionInfo,
  ApprovalRequest,
  ApprovalOption,
  PermissionMode,
  ModeBadge,
  UserPromptAttachment,
} from '@moxxy/sdk';

export type { ApprovalRequest, ApprovalOption, PermissionMode, ModeBadge, UserPromptAttachment };

/**
 * Window/event-bus key a thin client listens for to re-fetch `session.info`
 * after switching the active mode out-of-band (e.g. the desktop composer's Goal
 * button). Lives in the contract — not a UI module — so the shared
 * `useActiveModeBadge` hook can import the constant without reaching into any
 * platform's component tree. Platforms route it through their `EventBus`
 * capability (the desktop's wraps `window` events).
 */
export const SESSION_INFO_REFRESH_EVENT = 'moxxy:session-info-refresh';

// ---------- Interactive ask (permission / approval prompts) ---------------

/**
 * A decision the runner needs from the user, forwarded from the connected
 * session to the renderer. `kind: 'permission'` gates a tool call;
 * `kind: 'approval'` is a loop-strategy confirmation (research, …).
 * The renderer renders a bottom sheet and replies with {@link AskResponse}
 * keyed by `requestId`.
 */
export interface AskRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly kind: 'permission' | 'approval';
  /** Present for `kind: 'permission'`. */
  readonly tool?: { readonly name: string; readonly input: unknown; readonly description?: string };
  /** Present for `kind: 'approval'`. */
  readonly approval?: ApprovalRequest;
}

export interface AskResponse {
  /** Permission verdict (kind: 'permission'). */
  readonly mode?: PermissionMode;
  /** Chosen approval option id (kind: 'approval'). */
  readonly optionId?: string;
  /** Free-text follow-up when the chosen approval option requested it. */
  readonly text?: string;
}

export type { SessionInfo };
// `validateIpcInput` / `ipcInputSchemas` are exposed via the
// `@moxxy/desktop-ipc-contract/validation` subpath (not re-exported here)
// so the contract types stay a leaf — validation depends on the types,
// not the other way around.

// ---------- Uniform error envelope ----------------------------------------

/**
 * Stable classification for any error a main-process handler surfaces. The
 * renderer branches on `code` instead of string-matching English messages
 * (which drift). `message` is the human-readable detail.
 *
 *   - `invalid-payload` — runtime validation rejected the renderer's input.
 *   - `not-connected`   — no runner/session bound for the target workspace.
 *   - `no-workspace`    — no active workspace and none specified.
 *   - `not-supported`   — the host lacks the OPTIONAL capability behind the
 *                         command (no transcriber, workflows plugin not
 *                         loaded). Clients treat this as "hide/disable the
 *                         affordance", never as a failure to retry.
 *   - `runner-error`    — the runner/handler threw while doing the work.
 *   - `unknown`         — anything not otherwise classified.
 */
export type MoxxyIpcErrorCode =
  | 'invalid-payload'
  | 'not-connected'
  | 'no-workspace'
  | 'not-supported'
  | 'runner-error'
  | 'unknown';

export interface MoxxyIpcError {
  readonly code: MoxxyIpcErrorCode;
  readonly message: string;
}

/** Marker the envelope is wrapped in so the renderer can recover it from the
 *  Electron-prefixed `Error invoking remote method …` string. */
const IPC_ERROR_PREFIX = 'MOXXY_IPC_ERR:';

/** Serialize an envelope into a thrown Error's message (main side). */
export function encodeIpcError(err: MoxxyIpcError): string {
  return IPC_ERROR_PREFIX + JSON.stringify(err);
}

/** Recover an envelope from a rejected invoke()'s message, or null if the
 *  string isn't one of ours (renderer side). Electron prefixes the message,
 *  so we search for the marker rather than expecting it at index 0. */
export function decodeIpcError(message: string): MoxxyIpcError | null {
  const at = message.indexOf(IPC_ERROR_PREFIX);
  if (at < 0) return null;
  try {
    const parsed = JSON.parse(message.slice(at + IPC_ERROR_PREFIX.length)) as MoxxyIpcError;
    if (parsed && typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      return parsed;
    }
  } catch {
    /* trailing text wasn't valid JSON — not our envelope */
  }
  return null;
}

// ---------- Connection lifecycle -------------------------------------------

/**
 * State machine the main process broadcasts as it tries to reach a
 * working moxxy runner. The renderer reads the latest phase and
 * renders the right surface.
 */
export type ConnectionPhase =
  | { phase: 'idle' }
  | { phase: 'resolving-cli' }
  | { phase: 'cli-missing'; hint: string }
  | { phase: 'spawning'; cliPath: string; socket: string; pid?: number }
  | { phase: 'adopting'; socket: string }
  | { phase: 'attaching'; socket: string }
  | {
      phase: 'connected';
      socket: string;
      sessionId: string;
      activeProvider: string | null;
      activeMode: string | null;
    }
  | {
      phase: 'reconnecting';
      reason: string;
      attempt: number;
    }
  | { phase: 'failed'; error: string; hint?: string };

export interface ConnectionSnapshot {
  phase: ConnectionPhase;
  cliPath: string | null;
  attempts: number;
  log: ReadonlyArray<{ stream: 'stdout' | 'stderr'; line: string }>;
}

// ---------- Onboarding -----------------------------------------------------

/**
 * Provider-key + config state. The renderer flips to the init
 * wizard whenever `needsSetup` is true after a successful connect.
 */
export interface OnboardingStatus {
  cliInstalled: boolean;
  cliPath: string | null;
  hasProvider: boolean;
  /** ProviderName from `~/.moxxy/preferences.json`. */
  activeProvider: string | null;
}

/**
 * Node.js detection snapshot — drives the first onboarding step
 * (we can't install or run moxxy without Node).
 */
export interface NodeProbe {
  installed: boolean;
  version: string | null;
  bin: string | null;
}

// ---------- Desktop preferences (first-run + auth state) -------------------

export interface DesktopPrefs {
  onboardingComplete: boolean;
  clerkUserId: string | null;
  clerkDisplayName: string | null;
  signedInAt: number | null;
  /** Whether the user enabled the mobile gateway (the WebSocket bridge). The
   *  main process re-starts the bridge on boot when this is true so pairing
   *  survives a restart. Defaults to false (OFF) — exposing the host on the LAN
   *  is always an explicit opt-in. */
  mobileGatewayEnabled: boolean;
  version: 1;
}

// ---------- Workflows ------------------------------------------------------

export interface WorkflowSummary {
  name: string;
  description: string;
  enabled: boolean;
  scope: string;
  steps: number;
  triggers: string;
}

export interface WorkflowRun {
  ok: boolean;
  output: string;
  error?: string;
  steps: ReadonlyArray<{ id: string; status: string; error?: string }>;
}

// ---------- Mobile gateway (WebSocket bridge) ------------------------------

/**
 * Live status of the desktop's mobile gateway — the opt-in WebSocket bridge
 * that exposes the SAME IPC contract the renderer uses to a remote client (the
 * mobile app), letting a paired phone drive the host exactly like the TUI does.
 *
 * OFF by default; the user enables it explicitly from Settings → Mobile, which
 * binds the bridge on the LAN-advertised interface so a phone on the same Wi-Fi
 * can reach it (a deliberate local-network exposure, gated by the pairing
 * token). `connectUrl` IS the QR payload the mobile app scans — a
 * `ws(s)://host:port/?t=<token>` string the shipped app's `parsePairingQrPayload`
 * accepts verbatim.
 */
export interface MobileGatewayStatus {
  /** True while the bridge is running and accepting connections. */
  enabled: boolean;
  /** Advertised host a phone connects to (the LAN IP for a wildcard bind, or
   *  the bound host verbatim). Null while disabled. */
  host: string | null;
  /** Bound TCP port. Null while disabled. */
  port: number | null;
  /** The QR / manual-entry payload: `ws://host:port/?t=<token>`. Null while
   *  disabled. Scanning this in the mobile app pairs it to this host. */
  connectUrl: string | null;
  /** Current pairing token (also embedded in `connectUrl`). Null while
   *  disabled. */
  token: string | null;
  /** Number of mobile clients currently connected, when the transport can
   *  report it. */
  clientCount?: number;
}

/** Validation result for a draft workflow YAML (visual builder, phase 2). */
export interface WorkflowValidate {
  ok: boolean;
  errors: ReadonlyArray<string>;
}

/** Result of persisting a workflow from the builder. */
export interface WorkflowSave {
  name: string;
  scope: string;
  path: string;
}

/** One saved workflow's canonical YAML + on-disk metadata. */
export interface WorkflowDetail {
  name: string;
  scope: string;
  path: string;
  yaml: string;
}

// ---------- Settings -------------------------------------------------------

export interface ProviderEntry {
  name: string;
  /** True when the runner has activated this provider (credentials
   *  resolved). False = entry exists but key is missing or invalid. */
  ready: boolean;
}

export interface McpServerEntry {
  name: string;
  enabled: boolean;
  connected: boolean;
}

export interface VaultEntryName {
  name: string;
}

export interface SkillFile {
  name: string;
  /** True if the file is editable (lives under ~/.moxxy/skills/). */
  editable: boolean;
  /** First line of the skill's frontmatter `description`, when present. */
  description?: string;
}

// ---------- Desks ---------------------------------------------------------

export interface Desk {
  id: string;
  name: string;
  cwd: string;
  color: string;
  createdAt: number;
}

export interface DesksOverview {
  desks: Desk[];
  activeId: string | null;
}

// ---------- Chat -----------------------------------------------------------

export interface PromptAttachment {
  /** Local-file path the agent should be able to read. Absolute when
   *  picked from the workspace file tree, native-picker path when
   *  picked via Attach. */
  readonly path: string;
  /** Display name (basename of `path`). */
  readonly name: string;
}

export interface RunTurnArgs {
  prompt: string;
  model?: string;
  attachments?: ReadonlyArray<PromptAttachment>;
  /**
   * Inline attachments for REMOTE clients (the mobile app) that cannot
   * reference host filesystem paths: the payload itself crosses the wire
   * (base64 bytes for image/document/audio, inline text for file/stdin) in
   * the SDK's `UserPromptAttachment` shape, and the host forwards it to
   * `session.runTurn`'s `attachments` option untouched. Path-based
   * `attachments` stay the desktop's local-renderer path.
   */
  inlineAttachments?: ReadonlyArray<UserPromptAttachment>;
}

export interface RunTurnResult {
  turnId: string;
}

/** The app bundle ("dashboard") the desktop is currently running. */
export interface AppUpdateInfo {
  /** Running bundle version. */
  version: string;
  /** Whether it's the one baked into the .app or a hot-updated override. */
  source: 'bundled' | 'updated';
  /** True when this build has a signing key baked in (self-update enabled). */
  channelConfigured: boolean;
}

/** Result of checking the published manifest for a newer dashboard. */
export interface AppUpdateCheck {
  /** A newer, signature-valid bundle is published. */
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  /** False ⇒ the update needs a newer shell (a Tier-2 / installer update). */
  compatible: boolean;
  notes?: string;
  releaseUrl?: string;
  /** Set when the check itself failed (offline, not configured, …). */
  error?: string;
}

/** Streamed progress while a dashboard update downloads + installs. */
export interface AppUpdateProgress {
  phase: 'download' | 'verify' | 'extract' | 'activate';
  received?: number;
  total?: number;
  message?: string;
}

/** One recorded boot/update decision (mirrors `BootLogEntry` in
 *  `@moxxy/desktop-host/app-update`). The renderer only ever displays these. */
export interface AppBootLogEntry {
  ts: number;
  phase: 'boot' | 'recover' | 'probe' | 'confirm' | 'load-error';
  picked?: string;
  reason?: string;
  recoveredTo?: string;
  error?: string;
  electron?: string;
  abi?: string;
}

/** Self-update troubleshooting snapshot: the on-disk pointer state plus the
 *  recent boot-decision log, so a "downloaded but reverted" report is legible
 *  (the Updates → Diagnostics panel renders + copies this). */
export interface AppUpdateDiagnostics {
  /** Bundle version the running process loaded (override or floor). */
  running: string;
  /** `active.json` pointer — the version the bootstrap intends to load next. */
  active: string | null;
  /** Last version that confirmed a healthy render. */
  confirmed: string | null;
  /** Versions poisoned by a failed/unconfirmed boot. */
  bad: string[];
  /** Bundle version dirs currently present under `<userData>/app/`. */
  staged: string[];
  /** Most-recent-last boot-decision entries. */
  log: AppBootLogEntry[];
}

// ---------- Events the renderer subscribes to ------------------------------

/** Parsed components of an opened `moxxy://` URL. `host` is the first
 *  authority segment (the "action", e.g. `open` in `moxxy://open/...`),
 *  `path` the remainder of the path, and `params` the decoded query string.
 *  General-purpose transport: notification clicks + action deep-links route
 *  through this in the renderer's DeepLinkBridge. */
export interface DeepLinkPayload {
  readonly url: string;
  readonly host: string;
  readonly path: string;
  readonly params: Record<string, string>;
}

/**
 * Channel names. Centralized so a typo is caught at the type level
 * (the preload's `subscribe(channel, handler)` is generic over this
 * map).
 */
export interface IpcEvents {
  /** Phase of the supervisor for `workspaceId`. The renderer's
   *  ConnectionStore keeps one phase per workspace; the foreground UI
   *  reads only the active workspace's. */
  'connection.changed': { workspaceId: string; phase: ConnectionPhase };
  /** Runner event tagged with the workspace it came from so the
   *  renderer can dispatch into the right per-workspace chat state. */
  'runner.event': { workspaceId: string; event: MoxxyEvent };
  'runner.turn.complete': {
    workspaceId: string;
    turnId: string;
    error: string | null;
  };
  /** Streamed during `onboarding.installMoxxyCli`. One event per
   *  stdout/stderr line; the invoke() also returns the final exit
   *  code so callers can short-circuit on success. */
  'onboarding.install.progress': string;
  /** Streamed during `app.updateDashboard` — one event per download/verify/
   *  extract/activate step so the Updates UI can show a progress bar. */
  'app.update.progress': AppUpdateProgress;
  /** The runner needs a permission/approval decision — the renderer
   *  shows a bottom sheet and replies via `ask.respond`. */
  'ask.request': AskRequest;
  /** A `moxxy://` URL was opened while the app is running (notification /
   *  action link, or an OS protocol launch). The renderer's DeepLinkBridge
   *  routes it by `host`/`path`. Links that arrive before the renderer is
   *  listening are buffered and pulled via `deepLink:drain` on mount. */
  'deepLink:received': DeepLinkPayload;
  /** The mobile gateway's status changed (enabled/disabled, token rotated, a
   *  client connected/left) — the Settings → Mobile tab re-renders the QR +
   *  client count from this without polling. */
  'mobileGateway.changed': MobileGatewayStatus;
}

// ---------- Invokable commands (renderer → main) --------------------------

/**
 * Every invokable IPC command the renderer can call. The preload
 * surface is built mechanically from this; misnaming a command in the
 * renderer is a type error rather than a silent runtime failure.
 */
export interface IpcCommands {
  /** Reply to an `ask.request` (permission/approval bottom sheet). */
  'ask.respond': (args: { requestId: string; response: AskResponse }) => Promise<void>;
  /** Snapshot every supervised workspace (active + background). Used
   *  on cold start so the renderer learns about running background
   *  workspaces without waiting for events. */
  'connection.snapshotAll': () => Promise<
    ReadonlyArray<ConnectionSnapshot & { workspaceId: string }>
  >;
  /** Currently foregrounded workspace id, or null if no workspace is
   *  bound. */
  'connection.activeWorkspace': () => Promise<string | null>;
  /** Kick the supervisor out of failed / reconnecting back into the
   *  resolution loop. */
  'connection.retry': (args?: { workspaceId?: string }) => Promise<void>;

  /** Drain `moxxy://` deep-links that arrived before the renderer was
   *  listening (cold-start launch, or before the bridge mounted). The
   *  DeepLinkBridge calls this once on mount; live links thereafter arrive
   *  via the `deepLink:received` event. Returns + clears the main-side
   *  buffer. */
  'deepLink:drain': () => Promise<DeepLinkPayload[]>;

  /** Version + on-disk path of the moxxy CLI the desktop is currently
   *  running. Either field may be null if it can't be resolved. */
  'app.cliInfo': () => Promise<{ version: string | null; path: string | null }>;
  /** Install the latest published `@moxxy/cli` into the writable
   *  userData copy, then restart every runner so the new binary is
   *  used immediately. Streams npm output via
   *  `onboarding.install.progress`. Returns the exit code (0 = ok) and
   *  the post-update version. */
  'app.updateCli': () => Promise<{ code: number; version: string | null }>;

  /** The dashboard (app bundle) the desktop is currently running. */
  'app.updateInfo': () => Promise<AppUpdateInfo>;
  /** Fetch + verify the published manifest and report whether a newer
   *  dashboard is available (and whether it fits this shell). Never throws —
   *  failures come back in `error`. */
  'app.checkUpdate': () => Promise<AppUpdateCheck>;
  /** Download + verify + install the latest compatible dashboard bundle into
   *  the writable userData copy, streaming `app.update.progress`. On success
   *  the new bundle activates on the next launch (the UI offers a relaunch).
   *  The update SOURCE is resolved entirely main-side — the renderer passes no
   *  URL. */
  'app.updateDashboard': () => Promise<{ ok: boolean; version: string | null; error?: string }>;
  /** Relaunch the app so a freshly-installed dashboard bundle takes effect. */
  'app.relaunch': () => Promise<void>;
  /** Renderer → main heartbeat: the React tree mounted past the splash. Clears
   *  the boot-probe so a hot-updated bundle is marked healthy (no-op on the
   *  bundled floor). */
  'app.appBooted': () => Promise<void>;
  /** Renderer → main: the boot heartbeat could not be delivered (all retries
   *  failed). Recorded to the boot-log so a confirm-path failure is visible
   *  rather than silently letting the probe revert a healthy bundle. */
  'app.bootHeartbeatFailed': (args: { error: string }) => Promise<void>;
  /** Self-update troubleshooting snapshot (pointer state + recent boot log). */
  'app.updateDiagnostics': () => Promise<AppUpdateDiagnostics>;

  'onboarding.status': () => Promise<OnboardingStatus>;
  /** Probe Node.js — used by the first wizard step before we offer
   *  the install. */
  'onboarding.probeNode': () => Promise<NodeProbe>;
  /** Run `npm install -g @moxxy/cli`. Streams progress via
   *  `onboarding.install.progress`. Returns the exit code (0 = ok). */
  'onboarding.installMoxxyCli': () => Promise<number>;
  /** Download + extract the official Node LTS for this machine into the
   *  app's data dir and put it on PATH (no admin / package manager).
   *  Streams progress via `onboarding.install.progress`; resolves with
   *  the installed version on success. */
  'onboarding.installNode': () => Promise<{ ok: boolean; version: string | null }>;
  /** Open a URL in the user's default browser. Used for the Node.js
   *  install fallback (the manual nodejs.org download). */
  'onboarding.openExternal': (args: { url: string }) => Promise<void>;
  /** Run `moxxy vault set <NAME>_API_KEY` with the given secret piped
   *  on stdin, then call `provider.setActive` on the running session
   *  so the next turn picks it up without a relaunch. */
  'onboarding.saveProviderKey': (args: { provider: string; secret: string }) => Promise<void>;
  /** Returns how a provider authenticates so the wizard can pick the
   *  right UI affordance: a key field vs an OAuth button. */
  'onboarding.providerAuthKind': (args: { provider: string }) => Promise<'oauth' | 'api-key'>;
  /** Spawn `moxxy login <provider>`. The CLI opens the browser and
   *  runs the OAuth flow. stdout/stderr are streamed via
   *  `onboarding.install.progress`. Resolves with the exit code. */
  'onboarding.runProviderLogin': (args: { provider: string }) => Promise<number>;

  'desks.list': () => Promise<DesksOverview>;
  'desks.create': (args: { name: string; cwd: string }) => Promise<Desk>;
  'desks.remove': (args: { id: string }) => Promise<void>;
  'desks.setActive': (args: { id: string }) => Promise<void>;
  'desks.rename': (args: { id: string; name: string }) => Promise<Desk>;
  /** Open a native folder picker; resolves to the absolute path or null
   *  if the user cancelled. */
  'desks.pickFolder': () => Promise<string | null>;

  /** Returns the runner's SessionInfo snapshot for the workspace.
   *  Defaults to the active workspace. */
  'session.info': (args?: { workspaceId?: string }) => Promise<SessionInfo | null>;
  /** Issue a new turn. Defaults to the active workspace; pass a
   *  workspaceId to start a turn in a background workspace. Events
   *  stream back via 'runner.event' tagged with the same id. */
  'session.runTurn': (
    args: RunTurnArgs & { workspaceId?: string },
  ) => Promise<RunTurnResult>;
  /** Abort the named turn. Best-effort. */
  'session.abortTurn': (args: {
    workspaceId?: string;
    turnId: string;
  }) => Promise<void>;
  /** Switch the active provider. The vault must already hold the
   *  matching credential. */
  'session.setProvider': (args: {
    workspaceId?: string;
    provider: string;
  }) => Promise<void>;
  /** Switch the active mode. */
  'session.setMode': (args: { workspaceId?: string; mode: string }) => Promise<void>;
  /** Start a fresh conversation (the `/new` command): wipe the workspace's
   *  persisted runner session and restart it so the model context resets and
   *  doesn't resurrect on the next app launch. The renderer clears its own
   *  transcript separately. */
  'session.newSession': (args: { workspaceId?: string }) => Promise<void>;
  /** Toggle auto-approve ("yolo") for the workspace's session: when
   *  enabled, tool calls are allowed WITHOUT showing the approval sheet.
   *  Goal mode turns this on for hands-off autonomous runs. Lives on the
   *  per-workspace SessionDriver, so it resets to off if the runner
   *  reconnects (the renderer re-applies it on connect). */
  'session.setAutoApprove': (args: {
    workspaceId?: string;
    enabled: boolean;
  }) => Promise<void>;
  /** Run a slash command on the workspace's runner. The runner returns
   *  a CommandOutput (text / session-action / noop / error) which the
   *  caller renders inline in the transcript. */
  'session.runCommand': (args: {
    workspaceId?: string;
    name: string;
    args: string;
  }) => Promise<{
    readonly kind: 'text' | 'session-action' | 'noop' | 'error';
    readonly text?: string;
    readonly action?: 'new' | 'clear' | 'exit';
    readonly notice?: string;
    readonly message?: string;
  }>;
  /** True when the runner has an active transcriber plugin. UI uses
   *  this to enable/disable the mic button. */
  'session.hasTranscriber': () => Promise<boolean>;
  /** Forward an audio blob to the runner's active transcriber.
   *  Audio must be base64-encoded; returns the recognised text. */
  'session.transcribe': (args: {
    audioBase64: string;
    mimeType?: string;
  }) => Promise<string>;
  /** Synthesize text to speech via the runner's active synthesizer (e.g. a
   *  user-authored ElevenLabs plugin). Returns base64 audio + its MIME type,
   *  or null when no synthesizer is active (the renderer then falls back to
   *  the OS `speechSynthesis` voice). */
  'session.synthesize': (args: {
    workspaceId?: string;
    text: string;
  }) => Promise<{ audioBase64: string; mimeType: string } | null>;
  /** Open a native file picker and return the absolute path the user
   *  chose. Null when cancelled. */
  'session.pickAttachment': () => Promise<string | null>;
  /** Persist a pasted/dropped image blob (the renderer can't write
   *  files) to a temp file the agent can read, and return it as a
   *  {@link PromptAttachment} ready to ship on the next turn. Rejects
   *  if the image exceeds the attachment size cap. */
  'session.saveImageAttachment': (args: {
    /** Base64-encoded image bytes (no `data:` prefix). */
    dataBase64: string;
    /** MIME type from the clipboard blob, e.g. `image/png`. */
    mediaType: string;
    /** Optional source filename; a friendly default is used otherwise. */
    name?: string;
  }) => Promise<PromptAttachment>;

  // ---- Workspace filesystem browsing ------------------------------------
  /** List one directory inside the workspace's cwd. Relative paths
   *  are resolved against the active desk's cwd; absolute paths must
   *  stay below the cwd or the call errors (no traversing out of the
   *  workspace). Returns entries sorted directories-first. */
  'workspace.listDir': (args: {
    workspaceId: string;
    path?: string;
  }) => Promise<{
    readonly cwd: string;
    readonly path: string;
    readonly entries: ReadonlyArray<{
      readonly name: string;
      readonly kind: 'file' | 'dir';
    }>;
  }>;

  // ---- Chat transcript log (main-process append-only NDJSON) ------------
  /** Append committed runner events to the workspace's durable log.
   *  Append-only: never re-serialises old events. */
  'chat.append': (args: {
    workspaceId: string;
    events: ReadonlyArray<MoxxyEvent>;
  }) => Promise<void>;
  /** Load a page of events ending at `before` (a line-index cursor; null
   *  = the tail). Returns the page oldest-first plus `prevCursor` to
   *  request the next-older page (null when the start is reached). */
  'chat.loadSegment': (args: {
    workspaceId: string;
    before: number | null;
    limit: number;
  }) => Promise<{ events: ReadonlyArray<MoxxyEvent>; prevCursor: number | null }>;
  /** Truncate a workspace's log (Clear conversation). */
  'chat.clearLog': (args: { workspaceId: string }) => Promise<void>;
  /** One-time migration: the renderer hands up the events it parsed from
   *  the legacy localStorage blobs; the main process seeds the NDJSON
   *  logs. Idempotent — skips workspaces whose log already exists. */
  'chat.migrate': (args: {
    workspaces: ReadonlyArray<{ workspaceId: string; events: ReadonlyArray<MoxxyEvent> }>;
  }) => Promise<void>;

  // Workflows
  'workflows.list': () => Promise<ReadonlyArray<WorkflowSummary>>;
  'workflows.setEnabled': (args: { name: string; enabled: boolean }) => Promise<void>;
  'workflows.run': (args: { name: string }) => Promise<WorkflowRun>;
  // Visual builder (phase 2). Resolve null/throw gracefully when the workflows
  // plugin (or the builder-capable host) is absent — the renderer feature-checks.
  /** Parse + validate a draft YAML without saving. */
  'workflows.validateDraft': (args: { yaml: string }) => Promise<WorkflowValidate>;
  /** Persist a workflow from full YAML (create or overwrite). */
  'workflows.save': (args: { yaml: string }) => Promise<WorkflowSave>;
  /** Fetch one saved workflow as canonical YAML (null when unknown). */
  'workflows.getRun': (args: { name: string }) => Promise<WorkflowDetail | null>;

  // Settings
  // Desktop preferences (separate from runner preferences).
  'prefs.read': () => Promise<DesktopPrefs>;
  'prefs.update': (patch: Partial<DesktopPrefs>) => Promise<DesktopPrefs>;

  // Focus-mode window control (from the floating widget back to main).
  'focus.close': () => Promise<void>;
  'focus.restoreMain': () => Promise<void>;
  /** Resize the focus window. Keeps the nearer screen edge pinned so the
   *  widget stays in its corner as it expands. `resizable` toggles OS
   *  edge-resize grabs — on for the mini-text panel (so the user can drag
   *  it bigger), off for the small inactive tile / active pill. */
  'focus.resize': (args: {
    width: number;
    height: number;
    resizable?: boolean;
  }) => Promise<void>;

  /** Provider list for the given workspace (defaults to active). */
  'settings.providers': (args?: { workspaceId?: string }) => Promise<ReadonlyArray<ProviderEntry>>;
  /** Hit the provider's /v1/models endpoint and return the model ids
   *  it advertises. Useful for admin-registered providers whose
   *  providers.json entry didn't enumerate models upfront. */
  'settings.fetchProviderModels': (args: { provider: string }) => Promise<ReadonlyArray<string>>;
  /** Lists every provider name the user could realistically pick from
   *  during onboarding — built-ins (anthropic, openai, openai-codex)
   *  plus anything in ~/.moxxy/providers.json. */
  'settings.providerCatalog': () => Promise<ReadonlyArray<string>>;
  /** Subset of providers that the user added via `provider_add` — the
   *  ones for which live /v1/models fetching is wired. */
  'settings.adminProviders': () => Promise<ReadonlyArray<string>>;
  'settings.mcpServers': (args?: { workspaceId?: string }) => Promise<ReadonlyArray<McpServerEntry>>;
  'settings.mcpToggle': (args: {
    workspaceId?: string;
    name: string;
    enabled: boolean;
  }) => Promise<void>;
  /** Vault entries are global per-user — no workspaceId. */
  'settings.vaultEntries': () => Promise<ReadonlyArray<VaultEntryName>>;
  /** Store (or overwrite) a vault secret. Value is encrypted at rest. */
  'settings.vaultSet': (args: { name: string; value: string }) => Promise<void>;
  /** Delete a vault secret by name. */
  'settings.vaultDelete': (args: { name: string }) => Promise<void>;
  /** Skills under ~/.moxxy/skills are global per-user — no workspaceId. */
  'settings.skills': () => Promise<ReadonlyArray<SkillFile>>;
  'settings.readSkill': (args: { name: string }) => Promise<string>;
  'settings.writeSkill': (args: { name: string; body: string }) => Promise<void>;
  'settings.deleteSkill': (args: { name: string }) => Promise<void>;

  // ---- Mobile gateway (WebSocket bridge) --------------------------------
  // These CONTROL the bridge, so they are host-only — see
  // REMOTE_DISALLOWED_COMMANDS — a remote (WS) client must never be able to
  // toggle the gateway or read/rotate the pairing token over the very transport
  // the token guards.
  /** Current gateway status (enabled, advertised host+port, connectUrl/QR
   *  payload, token, connected-client count). */
  'mobileGateway.status': () => Promise<MobileGatewayStatus>;
  /** Start (true) or stop (false) the gateway and persist the preference so it
   *  survives a restart. Starting binds the bridge on the LAN-advertised
   *  interface so a phone can reach it. Returns the resulting status. */
  'mobileGateway.setEnabled': (args: { enabled: boolean }) => Promise<MobileGatewayStatus>;
  /** Rotate the pairing token — invalidates the old QR and terminates every
   *  currently-connected client. Returns the status with the new token /
   *  connectUrl. No-op (returns disabled status) when the gateway is off. */
  'mobileGateway.rotateToken': () => Promise<MobileGatewayStatus>;
}

/** Names of every command, derived. */
export type IpcCommandName = keyof IpcCommands;

/**
 * Commands that only make sense on the machine running the host and must be
 * refused over a remote (WebSocket) transport: native OS dialogs that would pop
 * on the host rather than the remote client, focus-widget window control, and
 * the app relaunch. The WebSocket bus rejects these with a coded error; a remote
 * client can read this set to gray out the corresponding affordances. (Remote
 * clients attach files via `session.saveImageAttachment` instead of a picker.)
 */
export const REMOTE_DISALLOWED_COMMANDS: ReadonlySet<IpcCommandName> = new Set<IpcCommandName>([
  'desks.pickFolder',
  'session.pickAttachment',
  'focus.close',
  'focus.restoreMain',
  'focus.resize',
  'app.relaunch',
  // Bridge control: a remote client driving over the WS bridge must never be
  // able to toggle the gateway off, read the pairing token, or rotate it (which
  // would let it lock out the host or hand itself a fresh credential). These are
  // reachable only over the in-process Electron transport.
  'mobileGateway.status',
  'mobileGateway.setEnabled',
  'mobileGateway.rotateToken',
]);

// ---------- Shape the preload exposes on `window.moxxy` -------------------

export type SubscribeFn = <K extends keyof IpcEvents>(
  channel: K,
  handler: (payload: IpcEvents[K]) => void,
) => () => void;

export type InvokeFn = <K extends IpcCommandName>(
  command: K,
  ...args: Parameters<IpcCommands[K]>
) => ReturnType<IpcCommands[K]>;

export interface MoxxyApi {
  invoke: InvokeFn;
  subscribe: SubscribeFn;
}

import type {
  MoxxyEvent,
  SessionInfo,
  OpenSurfaceResult,
  SurfaceInfo,
  SurfaceInputMessage,
  SurfaceSize,
} from '@moxxy/sdk';

import type { AskResponse } from './ask.js';
import type { ConnectionSnapshot } from './connection.js';
import type { OnboardingStatus, NodeProbe } from './onboarding.js';
import type { DesktopPrefs } from './prefs.js';
import type {
  WorkflowSummary,
  WorkflowRun,
  WorkflowValidate,
  WorkflowSave,
  WorkflowDetail,
} from './workflows.js';
import type { MobileGatewayStatus } from './mobile.js';
import type {
  ProviderEntry,
  McpServerEntry,
  VaultEntryName,
  SkillFile,
  ReasoningEffort,
} from './settings.js';
import type { Desk, DeskSession, DesksOverview, SessionsOverview } from './desks.js';
import type { PromptAttachment, RunTurnArgs, RunTurnResult } from './chat.js';
import type {
  AppUpdateInfo,
  AppUpdateCheck,
  AppUpdateDiagnostics,
} from './app-update.js';
import type { DeepLinkPayload } from './deep-link.js';
import type { AppInstallStatus, AnonymizerParseResult } from './apps.js';

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
   *  URL. `requiresFullUpdate` ⇒ the bundle was deliberately NOT staged: its
   *  runner protocol outruns the spawnable CLI, so only the full app installer
   *  (Tier-2) can deliver it. */
  'app.updateDashboard': () => Promise<{
    ok: boolean;
    version: string | null;
    error?: string;
    requiresFullUpdate?: boolean;
  }>;
  /** Download + install the FULL app installer (Tier-2, electron-updater) for
   *  the newest desktop release, streaming `app.update.progress`. The path for
   *  updates a hot-update can't deliver (`requiresFullUpdate` — runner bump —
   *  or an Electron/ABI `incompatible`). The feed is resolved entirely
   *  main-side (the renderer passes no URL), pinned at the exact
   *  `desktop-v<version>` release assets. On success the app quits and
   *  reinstalls itself, so callers may never observe the resolved promise;
   *  failures (e.g. unsigned macOS build, missing installer asset) come back
   *  in `error` so the UI can fall back to the release page. */
  'app.updateShell': () => Promise<{ ok: boolean; error?: string }>;
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

  // ---- Interactive provider sign-in (OAuth) ------------------------------
  /** Begin an interactive sign-in for `provider`, correlated by the
   *  renderer-supplied `loginId`. Spawns `moxxy login <provider>`, which opens
   *  the browser; the CLI streams progress via `provider.login.output` and —
   *  for out-of-band providers (claude-code) — asks for a pasted token /
   *  `code#state` via `provider.login.prompt`. Resolves once the subprocess is
   *  spawned; completion arrives as `provider.login.done`. Used by both the
   *  onboarding wizard and Settings → Providers. */
  'provider.login.start': (args: { loginId: string; provider: string }) => Promise<void>;
  /** Answer the current `provider.login.prompt` with one line (a pasted token,
   *  a `code#state`, or empty to take the browser branch). */
  'provider.login.answer': (args: { loginId: string; value: string }) => Promise<void>;
  /** Abort a running login (the sign-in modal was closed). No-op if it already
   *  finished. */
  'provider.login.cancel': (args: { loginId: string }) => Promise<void>;

  'desks.list': () => Promise<DesksOverview>;
  'desks.create': (args: { name: string; cwd: string }) => Promise<Desk>;
  'desks.remove': (args: { id: string }) => Promise<void>;
  'desks.setActive': (args: { id: string }) => Promise<void>;
  'desks.rename': (args: { id: string; name: string }) => Promise<Desk>;
  /** Open a native folder picker; resolves to the absolute path or null
   *  if the user cancelled. */
  'desks.pickFolder': () => Promise<string | null>;

  // ---- Sessions (multiple conversations per desk) ------------------------
  /** List a desk's sessions (defaults to the active desk). */
  'sessions.list': (args?: { deskId?: string }) => Promise<SessionsOverview>;
  /** Create a NEW session under a desk (defaults to the active desk) and
   *  spawn its runner. Unlike `session.newSession` (which destructively
   *  resets the CURRENT session in place), this adds another concurrent
   *  conversation. Name defaults to "Session N". Does not change the
   *  active session — call `sessions.setActive` to foreground it. */
  'sessions.create': (args?: { deskId?: string; name?: string }) => Promise<DeskSession>;
  /** Foreground a session: persists it as its desk's active session (and
   *  that desk as the active desk), spawns its runner if needed, and
   *  points the pool at it. */
  'sessions.setActive': (args: { id: string }) => Promise<void>;
  /** Delete a session: stop its runner, delete its persisted runner log
   *  and chat transcript. A desk always keeps >= 1 session — removing the
   *  last one seeds a fresh empty session in its place. */
  'sessions.remove': (args: { id: string }) => Promise<void>;
  'sessions.rename': (args: { id: string; name: string }) => Promise<DeskSession>;

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
  /** The globally-active collaboration (only one runs at a time), or inactive.
   *  Read from the single-flight lock file so it spans all workspaces' runners;
   *  the Collaborate tab uses it to disable Start while one is running. */
  'collab.active': () => Promise<{
    readonly active: boolean;
    readonly sessionId?: string;
    readonly task?: string;
    readonly startedAtMs?: number;
  }>;
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
  /** Read a workspace file for the "Open" file viewer. Same cwd-scoping +
   *  symlink guard as `workspace.listDir`. Images come back inline
   *  (`kind:'image'`); text/code as UTF-8 (`kind:'text'`, head-excerpt +
   *  `truncated` past the cap). Binary-looking or very large files return
   *  `kind:'confirm'` (with `reason`) so the UI can ask before opening — pass
   *  `force: true` to then read it as text anyway. */
  'workspace.readFile': (args: {
    workspaceId: string;
    path: string;
    /** Bypass the binary/large `confirm` gate and decode as text. */
    force?: boolean;
  }) => Promise<{
    readonly path: string;
    readonly kind: 'text' | 'image' | 'pdf' | 'confirm';
    readonly content: string;
    readonly truncated: boolean;
    /** Back-compat: true exactly when `kind === 'text'`. */
    readonly text: boolean;
    readonly byteLength: number;
    /** Set when `kind:'image'` — `data:<mediaType>;base64,<base64>`. */
    readonly mediaType?: string;
    readonly base64?: string;
    /** Set when `kind:'confirm'` — why the gate fired. */
    readonly reason?: 'binary' | 'large';
  }>;

  // ---- Git (Files-changed pane + diff viewer) ---------------------------
  /** Whether `workspaceId`'s cwd is inside a git work tree. Gates the
   *  "Files changed" dropdown entry. */
  'git.isRepo': (args: { workspaceId: string }) => Promise<boolean>;
  /** Changed files (porcelain): staged + unstaged + untracked, relative to the
   *  repo root, each with a two-letter status code. Empty when not a repo. */
  'git.status': (args: { workspaceId: string }) => Promise<
    ReadonlyArray<{ readonly path: string; readonly status: string }>
  >;
  /** Unified diff for one changed file (HEAD vs working tree; untracked files
   *  diff against /dev/null). Capped in size like `workspace.readFile`. */
  'git.diff': (args: { workspaceId: string; path: string }) => Promise<{
    readonly path: string;
    readonly diff: string;
    readonly truncated: boolean;
  }>;

  // ---- Agentic surfaces (terminal · browser; runner protocol v8) --------
  /** Available surface kinds + availability for `workspaceId`. Empty when no
   *  surface plugin is loaded (or the runner predates v8). */
  'surface.list': (args: { workspaceId: string }) => Promise<ReadonlyArray<SurfaceInfo>>;
  /** Open (or attach to the shared) surface instance; returns a catch-up
   *  snapshot. The runner then streams frames via the `surface.data` event. */
  'surface.open': (args: { workspaceId: string; kind: string }) => Promise<OpenSurfaceResult>;
  /** Relay a viewer input message (keystroke, mouse, navigate) to a surface. */
  'surface.input': (args: {
    workspaceId: string;
    surfaceId: string;
    message: SurfaceInputMessage;
  }) => Promise<void>;
  /** Resize an open surface's viewport. */
  'surface.resize': (args: {
    workspaceId: string;
    surfaceId: string;
    size: SurfaceSize;
  }) => Promise<void>;
  /** Detach an open surface instance. */
  'surface.close': (args: { workspaceId: string; surfaceId: string }) => Promise<void>;

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
  /**
   * Persist a workflow from full YAML (create or overwrite). `previousName`
   * (the name the builder loaded) supports rename: when it differs from the
   * YAML's name, the old workflow file + entry are removed.
   */
  'workflows.save': (args: { yaml: string; previousName?: string }) => Promise<WorkflowSave>;
  /** Fetch one saved workflow as canonical YAML (null when unknown). */
  'workflows.getRun': (args: { name: string }) => Promise<WorkflowDetail | null>;
  /**
   * Answer a paused workflow's `awaitInput` question and resume the run (the
   * human-in-the-loop flow). `runId` comes from the `workflow_paused` plugin
   * event; `reply` is the operator's answer. Returns the (usually completed)
   * run result. Throws a coded error when the host predates the resume path.
   */
  'workflows.resume': (args: { runId: string; reply: string }) => Promise<WorkflowRun>;

  // ---- Desktop apps gallery (install lifecycle) ------------------------
  // All host-only (native pickers + filesystem + a network download). They are
  // deliberately NOT in REMOTE_ALLOWED_COMMANDS — a paired phone can't trigger
  // a desktop download or read/write local files.
  /** Current install state of an app's local assets. */
  'apps.status': (args: { appId: string }) => Promise<AppInstallStatus>;
  /** Download + install an app's local assets (e.g. the anonymizer's NER
   *  model). Streams `apps.install.progress`; resolves with the final status. */
  'apps.install': (args: { appId: string }) => Promise<AppInstallStatus>;
  /** Remove an app's installed local assets. */
  'apps.uninstall': (args: { appId: string }) => Promise<AppInstallStatus>;

  // ---- Document anonymizer (offline; the first app) --------------------
  /** Open a native picker scoped to anonymizable documents; returns the
   *  absolute path (remembered for authz) or null if cancelled. */
  'anonymizer.pickDocument': () => Promise<string | null>;
  /** Parse a user-picked / workspace document to plain text in main (reusing
   *  the attachment officeparser pipeline) so the renderer can redact it
   *  locally. The file is read ONLY if its provenance is authorized (picked or
   *  under a workspace cwd). No provider, no runner, no network. */
  'anonymizer.parseDocument': (args: { path: string }) => Promise<AnonymizerParseResult>;
  /** Parse a document the user DRAG-AND-DROPPED onto the anonymizer, from the
   *  base64 BYTES the renderer already holds (the dropped `File`'s contents) —
   *  NOT a path. The renderer legitimately has the dropped file's content, so
   *  this grants main no new authority: it extracts text from the supplied bytes
   *  (no fs read of a renderer-named path, no provider/runner/network). This is
   *  the safe alternative to taking a path, which a compromised renderer could
   *  forge to read an arbitrary file — exactly what the picker's provenance gate
   *  exists to prevent. Bounded size (see `ipcInputSchemas`). */
  'anonymizer.parseDocumentBytes': (args: {
    name: string;
    dataBase64: string;
  }) => Promise<AnonymizerParseResult>;
  /** Save renderer-produced redacted text to a user-chosen location via a
   *  native Save dialog. Main writes ONLY where the user pointed; returns the
   *  path or null if cancelled. */
  'anonymizer.saveRedacted': (args: {
    suggestedName: string;
    content: string;
  }) => Promise<string | null>;

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
  /** Enable/disable a provider on the runner (persists across restarts).
   *  Disabling the ACTIVE provider is refused with a clear error. */
  'settings.providerSetEnabled': (args: {
    workspaceId?: string;
    name: string;
    enabled: boolean;
  }) => Promise<void>;
  /** Patch a stored (runtime-registered) provider's config — live registry
   *  re-register + providers.json persist. Built-ins are not configurable. */
  'settings.providerConfigure': (args: {
    workspaceId?: string;
    name: string;
    patch: { baseURL?: string; defaultModel?: string; envVar?: string };
  }) => Promise<void>;
  /** Re-probe every provider's credentials on the runner so a key just saved
   *  via `settings.vaultSet` flips readiness without a restart. */
  'settings.providerRefreshReady': (args?: { workspaceId?: string }) => Promise<void>;
  /** Set the session's reasoning/thinking effort live on the runner — maps onto
   *  `config.context.reasoning` (the proven CLI path). `off` clears it.
   *  Session-scoped (not per-provider); honored only by models that advertise
   *  `supportsReasoning`. Throws a coded error against a pre-v9 runner. */
  'settings.setReasoning': (args: {
    workspaceId?: string;
    effort: ReasoningEffort;
  }) => Promise<void>;
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
  // These CONTROL the bridge, so they are host-only. The WS bus is
  // deny-by-default (see REMOTE_ALLOWED_COMMANDS) and these are NOT on the
  // allow-list — a remote (WS) client must never be able to toggle the gateway
  // or read/rotate the pairing token over the very transport the token guards.
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

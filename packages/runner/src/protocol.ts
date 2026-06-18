import { z } from 'zod';
import type {
  ApprovalDecision,
  ApprovalRequest,
  CommandOutput,
  MoxxyEvent,
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
  OpenSurfaceResult,
  SessionInfo,
  SurfaceDataMessage,
  SurfaceInfo,
  SurfaceInputMessage,
  SurfaceSize,
  TranscriptionResult,
  UserPromptAttachment,
} from '@moxxy/sdk';

/**
 * Wire contract between the runner (server) and thin clients. `attach`
 * exchanges versions so an incompatible client fails loudly instead of
 * misbehaving — but compatible skew is TOLERATED (see negotiation rule below).
 *
 * Versioning rule (two knobs):
 *   - {@link RUNNER_PROTOCOL_VERSION} is bumped on ANY protocol change
 *     (additive or breaking). It identifies "what this build speaks".
 *   - {@link MIN_COMPATIBLE_PROTOCOL_VERSION} is bumped ONLY on a BREAKING
 *     change — one that removes/renames a method or alters an existing
 *     method's params/result shape so an older peer would misbehave. It is
 *     the lowest CLIENT version whose CORE session protocol this server can
 *     still serve correctly.
 *
 * The handshake then accepts any client `>= MIN_COMPATIBLE_PROTOCOL_VERSION`
 * (Part A — tolerant negotiation): a NEWER client just won't call methods this
 * (older) server lacks, and an OLDER-but-still-compatible client never used the
 * methods this server added. Only a `< MIN_COMPATIBLE` client is genuinely
 * incompatible — that's the sole hard "mismatch". The server returns its OWN
 * version in {@link AttachResult.protocolVersion} so the client can gate
 * version-specific methods (e.g. the v4 builder family) and degrade gracefully
 * against an older runner instead of hitting a raw method-not-found.
 *
 * v2: adds mcp.* and workflow.* method families so a thin client can drive
 * the MCP-server admin + workflows panels remotely. Both families degrade
 * cleanly when the corresponding plugin isn't loaded on the runner — the
 * server returns an empty list / `null` rather than throwing. (Additive.)
 *
 * v3: adds `session.reset` (request) + `session.reset` (notification) so
 * `/new` clears the runner's authoritative log — not just a client's local
 * mirror — and every attached mirror clears in lockstep. Without it, a
 * mirror-only clear desyncs seq-contiguous `ingest` and the mirror silently
 * rejects every subsequent event. (Additive.)
 *
 * v4: adds the workflow *builder* method family (`workflow.validateDraft`,
 * `workflow.save`, `workflow.getRun`) so a thin client (TUI / desktop's
 * RemoteSession) can drive the visual builder remotely. Like the other
 * workflow.* methods they degrade cleanly: the server throws a clear "not
 * supported" error when the workflows plugin (or its builder slice) is absent.
 * (Additive — a v3 server simply lacks these three methods; a v4 client gates
 * them on the server's reported version, see {@link AttachResult}.)
 *
 * v5: adds `workflow.resume` so a thin client can answer a paused workflow's
 * `awaitInput` question and drive the run to completion (the human-in-the-loop
 * resume path). Like the rest of the workflow.* family it degrades cleanly: a
 * server whose workflows view predates resume throws a clear "not supported"
 * error, and a v5 client capability-gates the call on the server's reported
 * version (see {@link AttachResult}) so a v5 desktop attached to a v4 CLI gets
 * an actionable "update the CLI" message instead of a raw method-not-found.
 * (Additive — a v4 server simply lacks this one method.)
 *
 * v6: two additive changes.
 *   - `runTurn` accepts an optional client-supplied `turnId`, echoed onto every
 *     event of the turn. The desktop pre-mints a turn id per renderer request,
 *     and its per-turn event filters (skill-generation preview, turn hiding)
 *     only work when the runner's events actually carry that id. An older
 *     server ignores the field (zod strips unknown keys) and mints its own id —
 *     the reply still returns the AUTHORITATIVE id, so a v6 client on a v5
 *     server degrades to the old behavior instead of breaking.
 *   - `attach` accepts an optional `replay` param ('full' | 'none' |
 *     { tail: N }, default 'full') and the server sends a `replay.start`
 *     notification ({ fromSeq }) before the replay loop so the client can
 *     rebase its mirror to the first replayed seq. Lets the desktop skip the
 *     full-history replay (its renderer history comes from the NDJSON chat
 *     log, not the mirror). An older server ignores the param and replays in
 *     full from seq 0 without `replay.start` — still correct, just slower.
 *
 * v7: three additive provider-management methods backing the desktop's
 * interactive Settings → Providers tab.
 *   - `provider.setEnabled` toggles a provider on/off in the live registry
 *     (disable refuses the ACTIVE provider) and persists the disabled set to
 *     ~/.moxxy/preferences.json so the next boot's activation walk skips it.
 *   - `provider.refreshReady` re-probes every registered provider's
 *     credentials via the session's credential resolver and replaces
 *     `readyProviders` — so a key saved to the vault flips the readiness dot
 *     without a runner restart.
 *   - `provider.configure` patches a STORED (runtime-registered) provider's
 *     entry through the session's optional `providerAdmin` view (live
 *     re-register + providers.json persist); it throws a clear "not
 *     supported" error when the provider-admin plugin isn't wired.
 *   The server also broadcasts `info.changed` after every completed turn —
 *   a turn may have run registry-mutating tools (provider_add, mcp_add,
 *   workflow_create, …), and attached clients (the desktop Settings panel)
 *   re-render from that push instead of requiring an app restart. A v7
 *   client gates the new methods on the server's reported version.
 *
 * v8: adds the `surface.*` method family + the `surface.data` notification,
 * backing the desktop's agentic surfaces (an embedded shared terminal, an
 * in-window browser). A surface is a runner-owned interactive resource (a PTY,
 * a Playwright page) that the agent's tools and a thin client drive together:
 *   - `surface.list` enumerates the available kinds + availability.
 *   - `surface.open` opens (or attaches to the shared) instance for a kind and
 *     returns a catch-up snapshot; the server starts broadcasting that
 *     instance's frames as `surface.data` notifications.
 *   - `surface.input` / `surface.resize` relay a viewer's keystrokes / mouse /
 *     navigate / viewport changes back to the instance.
 *   - `surface.close` detaches one instance.
 *   All degrade cleanly when no surface plugin is loaded: `surface.list`
 *   returns `[]` and `surface.open` throws a clear "no surface" error. A v8
 *   client gates the family on the server's reported version.
 *
 * Every change v1→v8 has been ADDITIVE, so MIN_COMPATIBLE stays at 1: today's
 * server can serve any client back to v1, and any client v1+ can attach. Bump
 * MIN_COMPATIBLE to N only when landing a breaking change at version N.
 */
export const RUNNER_PROTOCOL_VERSION = 8;

/**
 * Lowest client protocol version this build's CORE session protocol is
 * compatible with. The handshake rejects only clients BELOW this. Since every
 * change through v6 was purely additive, this is 1 — bump it (to the new
 * version) the moment a genuinely BREAKING protocol change lands, and never
 * before. See the versioning rule in the module doc above.
 */
export const MIN_COMPATIBLE_PROTOCOL_VERSION = 1;

/** Request methods. Client->server unless noted. */
export const RunnerMethod = {
  /** client->server: handshake; returns the initial info snapshot. */
  Attach: 'attach',
  /** client->server: re-fetch the registry snapshot. */
  GetInfo: 'getInfo',
  /** client->server: start a turn; returns its turnId. Events stream separately. */
  RunTurn: 'runTurn',
  /** client->server: abort an in-flight turn. */
  Abort: 'abort',
  /**
   * client->server: `/new` — abort every in-flight turn, clear the runner's
   * authoritative event log (and, via the log's clear listeners, truncate
   * the persisted session JSONL so `--resume` can't resurrect the wiped
   * history). The runner broadcasts the `session.reset` notification to ALL
   * attached clients so every mirror clears in lockstep.
   */
  SessionReset: 'session.reset',
  /** client->server: declare which resolvers this client will answer. */
  SetResolver: 'setResolver',
  /** client->server: switch the active mode. */
  ModeSetActive: 'mode.setActive',
  /** client->server: switch the active provider (server resolves credentials). */
  ProviderSetActive: 'provider.setActive',
  /** client->server: enable/disable a provider (v7; persists to preferences). */
  ProviderSetEnabled: 'provider.setEnabled',
  /** client->server: re-probe every provider's credentials → readyProviders (v7). */
  ProviderRefreshReady: 'provider.refreshReady',
  /** client->server: patch a stored (runtime-registered) provider's config (v7). */
  ProviderConfigure: 'provider.configure',
  /** client->server: persist an allow-always permission rule. */
  PermissionAddAllow: 'permission.addAllow',
  /** client->server: run a registered slash command on the runner. */
  CommandRun: 'command.run',
  /** client->server: transcribe audio using the runner's active transcriber. */
  Transcribe: 'transcribe',
  /** client->server: synthesize text to audio using the runner's active synthesizer. */
  Synthesize: 'synthesize',
  /** client->server: list every MCP server the runner knows about. */
  McpListServers: 'mcp.listServers',
  /** client->server: enable an MCP server + attach its tools. */
  McpEnableAndAttach: 'mcp.enableAndAttach',
  /** client->server: detach an MCP server. */
  McpDetach: 'mcp.detach',
  /** client->server: list all workflows registered on the runner. */
  WorkflowList: 'workflow.list',
  /** client->server: enable/disable a workflow. */
  WorkflowSetEnabled: 'workflow.setEnabled',
  /** client->server: run a workflow now. */
  WorkflowRun: 'workflow.run',
  /** client->server: validate a draft workflow YAML (builder). */
  WorkflowValidateDraft: 'workflow.validateDraft',
  /** client->server: persist a workflow from full YAML (builder). */
  WorkflowSave: 'workflow.save',
  /** client->server: fetch one saved workflow as canonical YAML (builder). */
  WorkflowGetRun: 'workflow.getRun',
  /**
   * client->server: answer a paused workflow's `awaitInput` question and resume
   * the run (human-in-the-loop). v5 — the client gates this on the server's
   * reported version so an older runner returns an actionable error.
   */
  WorkflowResume: 'workflow.resume',
  /** client->server: list available surface kinds + availability (v8). */
  SurfaceList: 'surface.list',
  /** client->server: open (or attach to the shared) surface instance (v8). */
  SurfaceOpen: 'surface.open',
  /** client->server: relay a viewer input message to an open surface (v8). */
  SurfaceInput: 'surface.input',
  /** client->server: resize an open surface's viewport (v8). */
  SurfaceResize: 'surface.resize',
  /** client->server: detach an open surface instance (v8). */
  SurfaceClose: 'surface.close',
  /** server->client: ask this client to decide a tool-call permission. */
  PermissionCheck: 'permission.check',
  /** server->client: ask this client to confirm an approval checkpoint. */
  ApprovalConfirm: 'approval.confirm',
} as const;
export type RunnerMethod = (typeof RunnerMethod)[keyof typeof RunnerMethod];

/** Notification methods (no reply). All server->client. */
export const RunnerNotification = {
  /** A new event was appended to the log. */
  Event: 'event',
  /** A turn finished (cleanly or with an error). */
  TurnComplete: 'turn.complete',
  /** The registry snapshot changed (plugin reload, mode switch, …). */
  InfoChanged: 'info.changed',
  /**
   * The runner's event log was reset (`/new` from any client, or a
   * self-hosting channel clearing the local log directly). Mirrors MUST
   * clear: post-reset events restart at seq 0, which a seq-contiguous
   * mirror only accepts from an empty log.
   */
  SessionReset: 'session.reset',
  /**
   * Sent once, immediately before the attach-time replay loop (v6): the
   * first seq this connection will replay/stream. The client rebases its
   * (empty) mirror to `fromSeq` so a partial replay (`replay: 'none'` /
   * `{ tail }`) ingests contiguously instead of dropping every event.
   */
  ReplayStart: 'replay.start',
  /**
   * One outbound frame from an open surface (PTY bytes, a browser frame, a
   * url/title update). Multiplexed by `surfaceId`; the client routes it to the
   * matching pane. Broadcast to every attached client — a client that hasn't
   * opened that surface simply ignores frames it has no pane for (v8).
   */
  SurfaceData: 'surface.data',
} as const;
export type RunnerNotification = (typeof RunnerNotification)[keyof typeof RunnerNotification];

// ---------------------------------------------------------------------------
// Request params / results
// ---------------------------------------------------------------------------

/**
 * How much history `attach` replays into the client's mirror (v6).
 *   - 'full' (default): everything from seq 0 — the TUI / `moxxy attach` path.
 *   - 'none': nothing — the desktop path, whose renderer history comes from
 *     its own NDJSON chat log; only live events stream after attach.
 *   - { tail: N }: the last N events — enough recent context for a mirror
 *     without paying for the whole conversation.
 * The server announces the chosen start seq via the `replay.start`
 * notification so the client can rebase its mirror before ingesting.
 */
export type AttachReplay = 'full' | 'none' | { readonly tail: number };

export interface AttachParams {
  readonly protocolVersion: number;
  /** Channel role attaching (e.g. 'tui', 'telegram') - informational/logging. */
  readonly role: string;
  /** Replay events from this seq on attach so a late client sees history. */
  readonly sinceSeq?: number;
  /** Replay policy (v6). Older servers strip the key and replay in full. */
  readonly replay?: AttachReplay;
}
export interface AttachResult {
  readonly sessionId: string;
  readonly protocolVersion: number;
  readonly info: SessionInfo;
}

export interface RunTurnParams {
  readonly prompt: string;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly maxIterations?: number;
  readonly attachments?: ReadonlyArray<UserPromptAttachment>;
  /**
   * Client-supplied turn id (v6). When present the server runs the turn under
   * THIS id (so the client's per-turn event filters match) instead of minting
   * one; it must be unique — the server rejects an id already in flight.
   */
  readonly turnId?: string;
}
export interface RunTurnResult {
  readonly turnId: string;
}

export interface AbortParams {
  readonly turnId: string;
}

export interface SetResolverParams {
  /** This client will answer `permission.check` for the turns it owns. */
  readonly permission?: boolean;
  /** This client will answer `approval.confirm` for the turns it owns. */
  readonly approval?: boolean;
}

export interface ModeSetActiveParams {
  readonly name: string;
}

export interface ProviderSetActiveParams {
  readonly name: string;
  readonly config?: Record<string, unknown>;
}

export interface PermissionAddAllowParams {
  readonly name: string;
  readonly reason?: string;
}

export interface CommandRunParams {
  readonly name: string;
  readonly args: string;
  readonly channel: string;
}
export type CommandRunResult = CommandOutput;

export interface TranscribeParams {
  /** Base64-encoded audio bytes (JSON-safe transport of the binary). */
  readonly audio: string;
  readonly mimeType?: string;
  readonly language?: string;
  readonly prompt?: string;
}
export type TranscribeResult = TranscriptionResult;

export interface McpEnableAndAttachParams {
  readonly name: string;
}
export interface McpDetachParams {
  readonly name: string;
}

export interface WorkflowSetEnabledParams {
  readonly name: string;
  readonly enabled: boolean;
}
export interface WorkflowRunParams {
  readonly name: string;
}
export interface WorkflowValidateDraftParams {
  readonly yaml: string;
}
export interface WorkflowValidateDraftResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
}
export interface WorkflowSaveParams {
  readonly yaml: string;
  readonly previousName?: string;
}
export interface WorkflowSaveResult {
  readonly name: string;
  readonly scope: string;
  readonly path: string;
}
export interface WorkflowGetRunParams {
  readonly name: string;
}
export interface WorkflowGetRunResult {
  readonly name: string;
  readonly scope: string;
  readonly path: string;
  readonly yaml: string;
}
export interface WorkflowResumeParams {
  /** The paused run's id (from the `workflow_paused` event / run result). */
  readonly runId: string;
  /** The operator's reply, fed into the paused step's child agent. */
  readonly reply: string;
}
export interface WorkflowResumeResult {
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
  readonly steps: ReadonlyArray<{ readonly id: string; readonly status: string; readonly error?: string }>;
  /** `paused` when the run pauses AGAIN at a later awaitInput step. */
  readonly status?: 'completed' | 'paused' | 'failed';
  readonly runId?: string;
}

// Surfaces (v8). Open/relay shape mirrors the SDK's SurfaceHost.
export type SurfaceListResult = ReadonlyArray<SurfaceInfo>;
export interface SurfaceOpenParams {
  readonly kind: string;
}
export type SurfaceOpenResult = OpenSurfaceResult;
export interface SurfaceInputParams {
  readonly surfaceId: string;
  readonly message: SurfaceInputMessage;
}
export interface SurfaceResizeParams {
  readonly surfaceId: string;
  readonly size: SurfaceSize;
}
export interface SurfaceCloseParams {
  readonly surfaceId: string;
}
/** One `surface.data` notification: a frame from an open surface instance. */
export interface SurfaceDataNotification {
  readonly data: SurfaceDataMessage;
}

export interface PermissionCheckParams {
  readonly turnId: string;
  readonly call: PendingToolCall;
  readonly ctx: PermissionContext;
}
export type PermissionCheckResult = PermissionDecision;

export interface ApprovalConfirmParams {
  readonly turnId: string;
  readonly request: ApprovalRequest;
}
export type ApprovalConfirmResult = ApprovalDecision;

// ---------------------------------------------------------------------------
// Notification payloads
// ---------------------------------------------------------------------------

export interface EventNotification {
  readonly event: MoxxyEvent;
}
export interface TurnCompleteNotification {
  readonly turnId: string;
  readonly error?: string;
}
export interface InfoChangedNotification {
  readonly info: SessionInfo;
}
export interface ReplayStartNotification {
  /** First seq this connection replays/streams; the mirror rebases to it. */
  readonly fromSeq: number;
}

// ---------------------------------------------------------------------------
// Inbound validation (control plane). The runner validates client->server
// request params before acting on them; large opaque payloads (events, info
// snapshots) ride through as typed pass-throughs since the transport already
// JSON round-trips them and they originate from our own server.
// ---------------------------------------------------------------------------

const attachmentSchema = z
  .object({
    kind: z.string(),
    content: z.string(),
    name: z.string().optional(),
    mediaType: z.string().optional(),
  })
  .passthrough();

export const attachParamsSchema = z.object({
  protocolVersion: z.number(),
  role: z.string(),
  sinceSeq: z.number().int().nonnegative().optional(),
  replay: z
    .union([
      z.literal('full'),
      z.literal('none'),
      z.object({ tail: z.number().int().positive() }),
    ])
    .optional(),
});

export const runTurnParamsSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  attachments: z.array(attachmentSchema).optional(),
  // Bounded like the other id-bearing params so a hostile client can't stuff
  // an arbitrary blob into every event of the turn.
  turnId: z.string().min(1).max(120).optional(),
});

export const abortParamsSchema = z.object({ turnId: z.string() });

export const setResolverParamsSchema = z.object({
  permission: z.boolean().optional(),
  approval: z.boolean().optional(),
});

export const modeSetActiveParamsSchema = z.object({ name: z.string() });

export const providerSetActiveParamsSchema = z.object({
  name: z.string(),
  config: z.record(z.unknown()).optional(),
});

export const providerSetEnabledParamsSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * Patch for `provider.configure` (v7). Models are validated structurally
 * (id + contextWindow, passthrough for richer descriptor fields) — the same
 * looseness as the provider-admin store schema, so newer descriptor fields
 * round-trip through an older runner without being stripped.
 */
export const providerConfigureParamsSchema = z.object({
  name: z.string().min(1),
  patch: z.object({
    baseURL: z.string().url().optional(),
    defaultModel: z.string().min(1).optional(),
    envVar: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
    models: z
      .array(z.object({ id: z.string().min(1), contextWindow: z.number() }).passthrough())
      .min(1)
      .optional(),
  }),
});

export const permissionAddAllowParamsSchema = z.object({
  name: z.string(),
  reason: z.string().optional(),
});

export const commandRunParamsSchema = z.object({
  name: z.string(),
  args: z.string(),
  channel: z.string(),
});

export const transcribeParamsSchema = z.object({
  audio: z.string(),
  mimeType: z.string().optional(),
  language: z.string().optional(),
  prompt: z.string().optional(),
});

export const synthesizeParamsSchema = z.object({
  text: z.string(),
  voice: z.string().optional(),
  language: z.string().optional(),
  rate: z.number().optional(),
});

/** Wire result for `synthesize`: base64-encoded audio + its MIME type. */
export interface SynthesizeResult {
  /** Base64-encoded audio bytes. */
  readonly audio: string;
  readonly mimeType: string;
}

export const mcpEnableAndAttachParamsSchema = z.object({ name: z.string() });
export const mcpDetachParamsSchema = z.object({ name: z.string() });

export const workflowSetEnabledParamsSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
});
export const workflowRunParamsSchema = z.object({ name: z.string() });
// Builder params. YAML is bounded like the desktop IPC contract so a hostile
// client can't OOM the runner; the YAML is parsed + schema-validated downstream.
export const workflowValidateDraftParamsSchema = z.object({
  yaml: z.string().min(1).max(1_000_000),
});
export const workflowSaveParamsSchema = z.object({
  yaml: z.string().min(1).max(1_000_000),
  previousName: z.string().min(1).max(120).optional(),
});
export const workflowGetRunParamsSchema = z.object({ name: z.string().min(1).max(120) });
// Resume params. The reply is bounded so a hostile client can't OOM the runner
// (it is forwarded verbatim into the paused step's child agent prompt).
export const workflowResumeParamsSchema = z.object({
  runId: z.string().min(1).max(120),
  reply: z.string().min(1).max(100_000),
});

// Surface params (v8). The viewer message + size are surface-specific, so the
// shapes are intentionally loose (passthrough) — each kind defines its payload.
// The surfaceId and kind are bounded like the other id-bearing params; the
// input message is capped so a hostile client can't OOM the runner with a giant
// "paste" frame (a real paste is far below 1 MB).
export const surfaceOpenParamsSchema = z.object({
  kind: z.string().min(1).max(64),
});
/**
 * Bound a surface input message to ≤ 1 MB serialized WITHOUT paying a full
 * `JSON.stringify(m)` on the hot path. Surface input frames are tiny shallow
 * objects (a `type` discriminator plus a few primitive fields — terminal
 * `{type:'data', data}`, browser `{type:'click', fx, fy}`, etc.) sent at
 * keystroke/paste rate, so re-serializing the whole already-parsed object per
 * frame is wasted work + a throwaway string allocation.
 *
 * Fast path: walk the top-level entries once and accumulate a SAFE UPPER BOUND
 * on `JSON.stringify(m).length` (worst-case escaping for keys + string values,
 * fixed maxima for number/boolean/null). If that upper bound is ≤ 1 MB the
 * message provably fits, so we accept after an O(keys) scan with no stringify.
 * Because it only ever OVER-estimates, the fast path can never accept a message
 * the real serializer would reject.
 *
 * Slow path: a non-primitive value (nested object/array — not a shape any real
 * surface emits) or an upper bound over 1 MB falls back to the EXACT
 * `JSON.stringify(m).length <= 1_000_000` check. So the accepted/rejected set is
 * IDENTICAL to the prior unconditional stringify guard — the 1 MB cap holds for
 * every input; no wire-contract change.
 */
const MAX_SURFACE_INPUT_BYTES = 1_000_000;

function surfaceInputWithinCap(m: Record<string, unknown>): boolean {
  // `{` + `}` framing.
  let upper = 2;
  let primitiveOnly = true;
  for (const key in m) {
    if (!Object.prototype.hasOwnProperty.call(m, key)) continue;
    const v = m[key];
    const t = typeof v;
    // JSON omits undefined/function-valued keys entirely — don't count them.
    if (v === undefined || t === 'function') continue;
    // Per entry: `"key":value,` — quoted key (worst-case \uXXXX escaping is 6×
    // per char, + 2 quotes), a colon, the value, and a trailing comma.
    upper += key.length * 6 + 2 + 1 + 1;
    if (t === 'string') {
      // Worst-case every char escapes to \uXXXX (6×), plus the 2 quotes.
      upper += (v as string).length * 6 + 2;
    } else if (t === 'number') {
      upper += 25; // longest JSON number form
    } else if (t === 'boolean' || v === null) {
      upper += 5; // "false" / "null"
    } else {
      // Nested object/array — cannot bound cheaply.
      primitiveOnly = false;
      break;
    }
    if (upper > MAX_SURFACE_INPUT_BYTES) break; // can't conclude "fits" cheaply
  }
  if (primitiveOnly && upper <= MAX_SURFACE_INPUT_BYTES) return true;
  // Exact boundary, identical to the original guard.
  return JSON.stringify(m).length <= MAX_SURFACE_INPUT_BYTES;
}

export const surfaceInputParamsSchema = z.object({
  surfaceId: z.string().min(1).max(120),
  message: z
    .object({ type: z.string().min(1).max(64) })
    .passthrough()
    .refine((m) => surfaceInputWithinCap(m as Record<string, unknown>), {
      message: 'surface input message too large',
    }),
});
export const surfaceResizeParamsSchema = z.object({
  surfaceId: z.string().min(1).max(120),
  size: z.object({
    cols: z.number().int().positive().max(10_000).optional(),
    rows: z.number().int().positive().max(10_000).optional(),
    width: z.number().int().positive().max(100_000).optional(),
    height: z.number().int().positive().max(100_000).optional(),
  }),
});
export const surfaceCloseParamsSchema = z.object({
  surfaceId: z.string().min(1).max(120),
});

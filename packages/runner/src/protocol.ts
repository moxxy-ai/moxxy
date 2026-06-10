import { z } from 'zod';
import type {
  ApprovalDecision,
  ApprovalRequest,
  CommandOutput,
  MoxxyEvent,
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
  SessionInfo,
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
 * Every change v1→v4 has been ADDITIVE, so MIN_COMPATIBLE stays at 1: today's
 * server can serve any client back to v1, and any client v1+ can attach. Bump
 * MIN_COMPATIBLE to N only when landing a breaking change at version N.
 */
export const RUNNER_PROTOCOL_VERSION = 4;

/**
 * Lowest client protocol version this build's CORE session protocol is
 * compatible with. The handshake rejects only clients BELOW this. Since every
 * change through v4 was purely additive, this is 1 — bump it (to the new
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
} as const;
export type RunnerNotification = (typeof RunnerNotification)[keyof typeof RunnerNotification];

// ---------------------------------------------------------------------------
// Request params / results
// ---------------------------------------------------------------------------

export interface AttachParams {
  readonly protocolVersion: number;
  /** Channel role attaching (e.g. 'tui', 'telegram') - informational/logging. */
  readonly role: string;
  /** Replay events from this seq on attach so a late client sees history. */
  readonly sinceSeq?: number;
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
});

export const runTurnParamsSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  attachments: z.array(attachmentSchema).optional(),
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

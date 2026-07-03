import type { EventId, PluginId, SessionId, SkillId, ToolCallId, TurnId } from './ids.js';

export type EventSource = 'user' | 'model' | 'tool' | 'plugin' | 'system' | 'compactor';

export interface EventBase {
  readonly id: EventId;
  readonly seq: number;
  readonly ts: number;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly causationId?: EventId;
  readonly source: EventSource;
}

export interface UserPromptAttachment {
  readonly kind: 'stdin' | 'file' | 'image' | 'document' | 'audio';
  /**
   * Inline payload. Depends on `kind`:
   *   - `image` / `document` — base64-encoded bytes (a PDF is a `document`).
   *   - `file` / `stdin` — inline UTF-8 text (a text/code file, or text
   *     extracted from an Office doc). Oversized files carry a head excerpt
   *     plus a note pointing at a path the agent can `read_file` on demand.
   *   - `audio` — either base64-encoded bytes (when the channel hands raw
   *     audio straight through to a model with `supportsAudio`) or the
   *     transcript (when the channel pre-transcribed via the session's
   *     Transcriber). Channels SHOULD set `name` to disambiguate the two.
   */
  readonly content: string;
  /** Human-readable label, e.g. the file path, `image.png`, or `voice.ogg`. */
  readonly name?: string;
  /** MIME type — required for `image`, `document`, and raw `audio` so providers translate correctly. */
  readonly mediaType?: string;
}

/**
 * Provenance of a machine-initiated prompt: an ambient trigger (a fired
 * webhook, a fired schedule, or a triggered workflow) ran a turn rather than a
 * human typing it. Carried on {@link UserPromptEvent.origin} so renderers can
 * collapse the (often large, untrusted-payload-bearing) synthesized prompt into
 * a compact "trigger fired" marker instead of a giant user bubble. The prompt
 * text stays in the event (and thus in the model's context) — only the *display*
 * changes. Absent for an ordinary user-typed prompt.
 */
export interface TriggerOrigin {
  readonly kind: 'webhook' | 'schedule' | 'workflow';
  /** The trigger's name (webhook/schedule/workflow), for the marker label. */
  readonly name: string;
}

export interface UserPromptEvent extends EventBase {
  readonly type: 'user_prompt';
  readonly text: string;
  readonly attachments?: ReadonlyArray<UserPromptAttachment>;
  /** Set when an ambient trigger fired this turn (see {@link TriggerOrigin}). */
  readonly origin?: TriggerOrigin;
}

export interface AssistantChunkEvent extends EventBase {
  readonly type: 'assistant_chunk';
  readonly delta: string;
}

export interface AssistantMessageEvent extends EventBase {
  readonly type: 'assistant_message';
  readonly content: string;
  readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
}

/**
 * A live reasoning/thinking delta. Parallels {@link AssistantChunkEvent}: it is
 * streamed for the UI's live "thinking…" preview and is NOT retained in the
 * display log (renderers accumulate it ephemerally, clearing on the matching
 * {@link ReasoningMessageEvent} or the turn's `assistant_message`). Only
 * emitted when the active provider+model supports reasoning AND it is enabled
 * in that provider's config.
 */
export interface ReasoningChunkEvent extends EventBase {
  readonly type: 'reasoning_chunk';
  readonly delta: string;
}

/**
 * A finalized reasoning summary for ONE provider call. Parallels
 * {@link AssistantMessageEvent}: it is persisted + replayed, and because
 * `collectProviderStream` runs once per loop round these land between tool
 * batches (the "summary of the work done between calls" behavior). The
 * `signature`/`redacted`/`encrypted` fields exist purely for history
 * round-trip — Anthropic requires the signed `thinking` block be replayed
 * first on a tool-use continuation; Codex/Anthropic redacted thinking carries
 * an opaque blob replayed verbatim and never shown.
 */
export interface ReasoningMessageEvent extends EventBase {
  readonly type: 'reasoning_message';
  readonly content: string;
  /** Anthropic thinking-block signature; absent for providers that don't sign. */
  readonly signature?: string;
  /** True when the reasoning is redacted/encrypted and must not be displayed. */
  readonly redacted?: boolean;
  /** Opaque provider blob (Anthropic redacted_thinking data / Codex encrypted_content) replayed as-is. */
  readonly encrypted?: string;
}

export interface ToolCallRequestedEvent extends EventBase {
  readonly type: 'tool_call_requested';
  readonly callId: ToolCallId;
  readonly name: string;
  readonly input: unknown;
  readonly skillContext?: SkillId;
}

export interface ToolCallApprovedEvent extends EventBase {
  readonly type: 'tool_call_approved';
  readonly callId: ToolCallId;
  readonly decidedBy: 'policy' | 'resolver' | 'hook';
  readonly mode: 'allow' | 'allow_session' | 'allow_always';
}

export interface ToolCallDeniedEvent extends EventBase {
  readonly type: 'tool_call_denied';
  readonly callId: ToolCallId;
  readonly decidedBy: 'policy' | 'resolver' | 'hook';
  readonly reason: string;
}

export interface ToolResultEvent extends EventBase {
  readonly type: 'tool_result';
  readonly callId: ToolCallId;
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: { message: string; kind: 'aborted' | 'threw' | 'denied' | 'timeout' };
}

export interface SkillInvokedEvent extends EventBase {
  readonly type: 'skill_invoked';
  readonly skillId: SkillId;
  readonly name: string;
  readonly reason: 'trigger_match' | 'classifier' | 'manual' | 'load_skill_tool';
}

export interface SkillCreatedEvent extends EventBase {
  readonly type: 'skill_created';
  readonly skillId: SkillId;
  readonly name: string;
  readonly path: string;
  readonly scope: 'user' | 'project';
  readonly originatingPrompt: string;
}

export interface PluginRegisteredEvent extends EventBase {
  readonly type: 'plugin_registered';
  readonly pluginId: PluginId;
  readonly name: string;
  readonly version: string;
  // Keep in sync with PluginKind (plugin.ts). Inlined rather than imported to
  // avoid an events↔plugin type cycle (dep-cruiser flags circular deps). The
  // type-level test in events.test-d.ts asserts this union stays in lockstep
  // with PluginKind so future additions fail the build instead of drifting.
  readonly kind: ReadonlyArray<
    | 'tools'
    | 'provider'
    | 'mode'
    | 'compactor'
    | 'cache-strategy'
    | 'view-renderer'
    | 'tunnel-provider'
    | 'mcp'
    | 'cli'
    | 'channel'
    | 'surface'
    | 'hooks'
    | 'agent'
    | 'command'
    | 'transcriber'
    | 'synthesizer'
    | 'embedder'
    | 'isolator'
    | 'workflow-executor'
    | 'event-store'
    | 'reflector'
  >;
}

export interface PluginUnregisteredEvent extends EventBase {
  readonly type: 'plugin_unregistered';
  readonly pluginId: PluginId;
  readonly name: string;
  readonly reason: 'reload' | 'shutdown' | 'disabled';
}

export interface ModeIterationEvent extends EventBase {
  readonly type: 'mode_iteration';
  readonly strategy: string;
  readonly iteration: number;
  readonly routing?: 'resolved' | 'unresolved' | 'synthesized';
}

export interface CompactionEvent extends EventBase {
  readonly type: 'compaction';
  readonly compactor: string;
  /**
   * Inclusive `[fromSeq, toSeq]` range of event `seq` values this summary
   * replaces — NOT array indices. Consumers (`projectMessagesFromLog`,
   * `estimateContextTokens`) test `event.seq` against these bounds, so a
   * compactor MUST emit the `seq` of the first/last replaced event. (Today
   * `seq === arrayIndex` in the primary log, but that is not guaranteed for
   * mirrors or partial views — emit seqs to stay correct regardless.)
   */
  readonly replacedRange: readonly [number, number];
  readonly summary: string;
  readonly tokensSaved: number;
}

/**
 * Records a turn-boundary elision step (context-on-demand). Events at or below
 * `elidedThrough` (and not covered by a compaction) are projected as compact
 * stubs the model can expand with the `recall` tool. The high-water mark only
 * advances on whole-turn boundaries, so the elided prefix stays byte-stable
 * across the inner iterations of a turn — which is what lets prompt caching
 * keep hitting.
 */
export interface ElisionEvent extends EventBase {
  readonly type: 'elision';
  /** Inclusive seq high-water mark: events with `seq <= elidedThrough` are stubbed. */
  readonly elidedThrough: number;
  /** Turn-aligned [from,to] seq ranges newly stubbed by this step (informational). */
  readonly stubbedRanges: ReadonlyArray<readonly [number, number]>;
  /**
   * Whether old user/assistant text turns (not just bulky tool results) are
   * collapsed to stubs. Carried on the event so `projectMessagesFromLog` stays
   * a pure function of the log (no need to thread config through projection).
   * Note: even when true, conversational elision auto-disables for the session
   * once seq-based `recall` calls reach `conversationalRecallThreshold`.
   */
  readonly elideConversational: boolean;
  /**
   * Adaptive safety: after this many `recall({ seq })` calls (the form used to
   * recall elided TEXT turns), conversational elision turns off for the rest of
   * the session. Carried on the event so projection decides it from the log.
   */
  readonly conversationalRecallThreshold: number;
  /** Cap on total bytes of recalled content pinned verbatim below the HWM. */
  readonly maxRecallBytes: number;
  /** Tool names whose results are never stubbed (kept verbatim regardless of age). */
  readonly neverElideTools: ReadonlyArray<string>;
  readonly tokensSaved: number;
}

export interface ProviderRequestEvent extends EventBase {
  readonly type: 'provider_request';
  readonly provider: string;
  readonly model: string;
  readonly inputTokens?: number;
}

export interface ProviderResponseEvent extends EventBase {
  readonly type: 'provider_response';
  readonly provider: string;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
}

export interface ErrorEvent extends EventBase {
  readonly type: 'error';
  readonly kind: 'retryable' | 'fatal' | 'tool_threw' | 'hook_failed' | 'provider_failed';
  readonly message: string;
  readonly sourceEventId?: EventId;
  readonly attempt?: number;
}

export interface AbortEvent extends EventBase {
  readonly type: 'abort';
  readonly reason: string;
}

export interface PluginEvent extends EventBase {
  readonly type: 'plugin_event';
  readonly pluginId: PluginId;
  readonly subtype: string;
  readonly payload: unknown;
}

export type MoxxyEvent =
  | UserPromptEvent
  | AssistantChunkEvent
  | AssistantMessageEvent
  | ReasoningChunkEvent
  | ReasoningMessageEvent
  | ToolCallRequestedEvent
  | ToolCallApprovedEvent
  | ToolCallDeniedEvent
  | ToolResultEvent
  | SkillInvokedEvent
  | SkillCreatedEvent
  | PluginRegisteredEvent
  | PluginUnregisteredEvent
  | ModeIterationEvent
  | CompactionEvent
  | ElisionEvent
  | ProviderRequestEvent
  | ProviderResponseEvent
  | ErrorEvent
  | AbortEvent
  | PluginEvent;

export type MoxxyEventType = MoxxyEvent['type'];
export type MoxxyEventOfType<T extends MoxxyEventType> = Extract<MoxxyEvent, { type: T }>;

export type EmittedEvent = MoxxyEvent extends infer E
  ? E extends MoxxyEvent
    ? Omit<E, 'id' | 'seq' | 'ts'> & { ts?: number }
    : never
  : never;

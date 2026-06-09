/**
 * The mobile state model.
 *
 * `MobileState` keeps the reference app's field names verbatim so every screen
 * binds unchanged — but where the reference rebuilt that state from scratch by
 * folding raw gateway frames, this port COMPOSES `@moxxy/client-core`: the
 * chat store already does the event folding (assistant_chunk → streamingText,
 * id-dedup across replays, provider_response → usage, queue, compaction lock)
 * and the ask store owns the pending permission/approval prompts. What lives
 * here is therefore:
 *
 *   - the `MobileState` type + `emptyMobileState()` (the facade contract),
 *   - `buildMobileState()` — a pure presenter from client-core snapshots
 *     (plus the session.info fetch and the local UI slice) into that shape,
 *   - a tiny `applyLocalFrame` reducer for the few bits no shared store owns
 *     (voice-transcription lifecycle, surfaced errors),
 *   - the ask-response normalizers that translate the reference UI's
 *     `allow_once`-style decisions into the IPC contract's `PermissionMode`.
 *
 * Everything in this module is React-free and pure so the protocol tests can
 * drive it directly.
 */

import type { AskRequest, AskResponse, PermissionMode } from '@moxxy/desktop-ipc-contract';

export interface MobileState {
  readonly connected: boolean;
  readonly activeWorkspaceId: string | null;
  readonly workspaces: ReadonlyArray<Record<string, unknown>>;
  readonly sessions: ReadonlyArray<Record<string, unknown>>;
  readonly session: Record<string, unknown> | null;
  readonly agents: ReadonlyArray<Record<string, unknown>>;
  readonly workflows: ReadonlyArray<Record<string, unknown>>;
  readonly pendingPermissions: ReadonlyArray<Record<string, unknown>>;
  readonly pendingAsks: ReadonlyArray<Record<string, unknown>>;
  readonly commands: ReadonlyArray<Record<string, unknown>>;
  readonly chatEvents: ReadonlyArray<Record<string, unknown>>;
  readonly streamingText: string;
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly queue: ReadonlyArray<Record<string, unknown>>;
  readonly compacting: boolean;
  readonly usage: Record<string, unknown> | null;
  readonly autoApprove: boolean;
  readonly activeMode: string | null;
  readonly activeProvider: string | null;
  readonly modeBadge: Record<string, unknown> | null;
  readonly transcriptionId: string | null;
  readonly transcriptionText: string | null;
  readonly transcribing: boolean;
  readonly errors: ReadonlyArray<string>;
}

export function emptyMobileState(): MobileState {
  return {
    connected: false,
    activeWorkspaceId: null,
    workspaces: [],
    sessions: [],
    session: null,
    agents: [],
    workflows: [],
    pendingPermissions: [],
    pendingAsks: [],
    commands: [],
    chatEvents: [],
    streamingText: '',
    sending: false,
    activeTurnId: null,
    queue: [],
    compacting: false,
    usage: null,
    autoApprove: false,
    activeMode: null,
    activeProvider: null,
    modeBadge: null,
    transcriptionId: null,
    transcriptionText: null,
    transcribing: false,
    errors: [],
  };
}

// ---------- Local UI slice (state no shared store owns) ---------------------

export interface LocalUiState {
  readonly transcriptionId: string | null;
  readonly transcriptionText: string | null;
  readonly transcribing: boolean;
  readonly errors: ReadonlyArray<string>;
  /** Monotonic counter minting transcription ids (so the composer can tell a
   *  fresh result from the one it already consumed). */
  readonly seq: number;
}

export type LocalFrame =
  | { readonly type: 'reset' }
  | { readonly type: 'transcribe.started' }
  | { readonly type: 'transcribe.result'; readonly id?: string; readonly text: string }
  | { readonly type: 'error'; readonly message: string };

const MAX_ERRORS = 20;

export function emptyLocalUiState(): LocalUiState {
  return { transcriptionId: null, transcriptionText: null, transcribing: false, errors: [], seq: 0 };
}

export function applyLocalFrame(state: LocalUiState, frame: LocalFrame): LocalUiState {
  switch (frame.type) {
    case 'reset':
      return emptyLocalUiState();
    case 'transcribe.started':
      return { ...state, transcribing: true };
    case 'transcribe.result': {
      const seq = state.seq + 1;
      return {
        ...state,
        transcriptionId: frame.id ?? `transcribe-${seq}`,
        transcriptionText: frame.text,
        transcribing: false,
        seq,
      };
    }
    case 'error':
      return {
        ...state,
        transcribing: false,
        errors: [...state.errors, frame.message].slice(-MAX_ERRORS),
      };
  }
}

// ---------- Presenter: client-core snapshots → MobileState ------------------

/** The chat-store slice the presenter reads (structural — `UseChat` from
 *  `@moxxy/client-core` satisfies it). */
export interface ChatSourceState {
  readonly events: ReadonlyArray<unknown>;
  readonly streamingText: string;
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly compacting: boolean;
  readonly error: string | null;
}

/** chat-store usage accumulator (structural mirror of `UsageSnapshot`). */
export interface UsageSourceState {
  readonly latestPrompt: number | null;
  readonly perCall: ReadonlyArray<number>;
  readonly calls: number;
  readonly totalInput: number;
  readonly totalCacheRead: number;
  readonly totalCacheCreation: number;
  readonly totalOutput: number;
}

/** The slice of `SessionInfo` the presenter reads (structural — keeps test
 *  fixtures small; the real snapshot satisfies it). */
export interface SessionInfoLike {
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly activeProvider?: string | null;
  readonly activeMode?: string | null;
  readonly activeModeBadge?: { readonly label: string } | null;
  readonly commands?: ReadonlyArray<{ readonly name: string; readonly description?: string }>;
}

export interface MobileStateSources {
  readonly connected: boolean;
  readonly workspaceId: string | null;
  readonly info: SessionInfoLike | null;
  readonly chat: ChatSourceState;
  readonly queue: ReadonlyArray<{ readonly id: string; readonly prompt: string }>;
  readonly usage: UsageSourceState;
  /** Active model's context window (from `useContextUsage`), or null. */
  readonly contextWindow: number | null;
  readonly asks: ReadonlyArray<AskRequest>;
  readonly autoApprove: boolean;
  readonly workflows: ReadonlyArray<Record<string, unknown>>;
  readonly local: LocalUiState;
}

export function buildMobileState(src: MobileStateSources): MobileState {
  const workspaceId = src.workspaceId;
  const info = src.info;
  const name = workspaceName(info);
  const session: Record<string, unknown> | null = workspaceId
    ? {
        id: info?.sessionId ?? workspaceId,
        cwd: info?.cwd ?? '',
        live: true,
        readOnly: false,
        provider: info?.activeProvider ?? null,
      }
    : null;
  return {
    connected: src.connected,
    activeWorkspaceId: workspaceId,
    workspaces: workspaceId ? [{ id: workspaceId, name, unread: false }] : [],
    sessions: workspaceId
      ? [
          {
            id: workspaceId,
            name,
            live: true,
            readOnly: false,
            firstPrompt: firstUserPrompt(src.chat.events),
            provider: info?.activeProvider ?? null,
          },
        ]
      : [],
    session,
    // The IPC contract exposes no agent catalog — present the honest empty
    // list so the menu section simply doesn't render.
    agents: [],
    workflows: src.workflows,
    // Permission prompts ride the unified ask channel (kind: 'permission'),
    // so this list is structurally empty — AskSheet renders them from
    // pendingAsks instead.
    pendingPermissions: [],
    pendingAsks: src.asks.map((ask) => ({ ...ask })),
    commands: (info?.commands ?? []).map((command) => ({ ...command })),
    chatEvents: src.chat.events as ReadonlyArray<Record<string, unknown>>,
    streamingText: src.chat.streamingText,
    sending: src.chat.sending,
    activeTurnId: src.chat.activeTurnId,
    queue: src.queue.map((turn) => ({ ...turn })),
    compacting: src.chat.compacting,
    usage: buildUsageRecord(src.usage, src.contextWindow),
    autoApprove: src.autoApprove,
    activeMode: info?.activeMode ?? null,
    activeProvider: info?.activeProvider ?? null,
    modeBadge: info?.activeModeBadge ? { ...info.activeModeBadge } : null,
    transcriptionId: src.local.transcriptionId,
    transcriptionText: src.local.transcriptionText,
    transcribing: src.local.transcribing,
    errors: src.chat.error ? [...src.local.errors, src.chat.error] : src.local.errors,
  };
}

/** Mirror of the old gateway's usage record: the accumulator plus the resolved
 *  context window, or null when there is nothing to meter yet. */
export function buildUsageRecord(
  usage: UsageSourceState,
  contextWindow: number | null,
): Record<string, unknown> | null {
  if (usage.calls === 0 && usage.latestPrompt == null && contextWindow == null) return null;
  return { ...usage, contextWindow };
}

function workspaceName(info: SessionInfoLike | null): string {
  const cwd = info?.cwd ?? '';
  const base = cwd.split('/').filter(Boolean).pop();
  return base && base.length > 0 ? base : 'Moxxy';
}

function firstUserPrompt(events: ReadonlyArray<unknown>): string {
  for (const event of events) {
    const record = event as Record<string, unknown>;
    if (record?.type === 'user_prompt' && typeof record.text === 'string' && record.text.length > 0) {
      return record.text;
    }
  }
  return '';
}

// ---------- Ask-response normalization --------------------------------------

/** Reference UI decision modes → the contract's `PermissionMode` (the wire
 *  schema is strict, so `allow_once` MUST become `allow`). */
export function toPermissionMode(mode: string): PermissionMode {
  if (mode === 'allow_once' || mode === 'allow') return 'allow';
  if (mode === 'allow_session') return 'allow_session';
  if (mode === 'allow_always') return 'allow_always';
  return 'deny';
}

/** Normalize a loosely-shaped UI response (PermissionCard / ApprovalCard) into
 *  the strict `AskResponse` the contract validates — only the known fields,
 *  with the permission mode mapped. */
export function toAskResponse(response: Record<string, unknown>): AskResponse {
  const out: { mode?: PermissionMode; optionId?: string; text?: string } = {};
  if (typeof response.mode === 'string') out.mode = toPermissionMode(response.mode);
  if (typeof response.optionId === 'string') out.optionId = response.optionId;
  if (typeof response.text === 'string' && response.text.length > 0) out.text = response.text;
  return out;
}

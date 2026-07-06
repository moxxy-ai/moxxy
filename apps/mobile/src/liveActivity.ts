import type {
  SubagentGroupTranscriptItem,
  ToolGroupTranscriptItem,
  TranscriptItem,
} from './chatTranscript';
import type { MobileState } from './protocol';
import { textOf } from './utils/record';

export type MoxxyLiveActivityPhase =
  | 'working'
  | 'tool'
  | 'subagents'
  | 'waiting'
  | 'completed'
  | 'failed';

export type MoxxyLiveActivitySnapshot =
  | {
      readonly active: false;
      readonly reason: 'disconnected' | 'idle';
    }
  | {
      readonly active: true;
      readonly phase: MoxxyLiveActivityPhase;
      readonly progress: number;
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly title: string;
      readonly subtitle: string;
      readonly detail: string;
      readonly currentTool?: string;
      readonly pendingCount: number;
      readonly subagentCount: number;
    };

export type MoxxyLiveActivityTransition =
  | { readonly kind: 'none' }
  | { readonly kind: 'retain' }
  | { readonly kind: 'start-or-update'; readonly snapshot: ActiveMoxxyLiveActivitySnapshot }
  | {
      readonly kind: 'end';
      readonly snapshot: ActiveMoxxyLiveActivitySnapshot;
      readonly notification: MoxxyLiveActivityNotification;
    };

export type MoxxyLiveActivitySyncPlan =
  | { readonly kind: 'send' }
  | { readonly kind: 'defer'; readonly dueAt: number }
  | { readonly kind: 'skip' };

export interface MoxxyLiveActivityNotification {
  readonly title: string;
  readonly body: string;
}

export interface MoxxyLiveActivityNativeModule {
  readonly isAvailable?: () => Promise<boolean> | boolean;
  readonly startOrUpdate?: (snapshot: ActiveMoxxyLiveActivitySnapshot) => Promise<unknown> | unknown;
  readonly end?: (snapshot: ActiveMoxxyLiveActivitySnapshot) => Promise<void> | void;
  readonly requestNotificationAuthorization?: () => Promise<unknown> | unknown;
  readonly notifyCompletion?: (notification: MoxxyLiveActivityNotification) => Promise<void> | void;
}

export interface MoxxyLiveActivityClient {
  readonly isAvailable: () => Promise<boolean>;
  readonly requestNotificationAuthorization: () => Promise<boolean>;
  readonly startOrUpdate: (
    snapshot: ActiveMoxxyLiveActivitySnapshot,
  ) => Promise<{ readonly active: boolean; readonly activityId?: string | null; readonly pushToken?: string | null }>;
  readonly end: (snapshot: ActiveMoxxyLiveActivitySnapshot) => Promise<void>;
  readonly notifyCompletion: (notification: MoxxyLiveActivityNotification) => Promise<void>;
}

type ActiveMoxxyLiveActivitySnapshot = Extract<MoxxyLiveActivitySnapshot, { readonly active: true }>;

export function deriveMoxxyLiveActivitySnapshot(input: {
  readonly state: MobileState;
  readonly transcript: ReadonlyArray<TranscriptItem>;
}): MoxxyLiveActivitySnapshot {
  if (!input.state.connected || !input.state.activeWorkspaceId) {
    return { active: false, reason: 'disconnected' };
  }

  const base = baseSnapshot(input.state);
  const pendingCount = input.state.pendingPermissions.length + input.state.pendingAsks.length;
  if (pendingCount > 0) {
    return {
      ...base,
      phase: 'waiting',
      progress: 0.85,
      detail: 'Waiting for your decision',
      pendingCount,
    };
  }

  const hasStreamingResponse =
    input.state.streamingText.trim().length > 0 || Boolean(latestStreamingAssistant(input.transcript));
  if (hasStreamingResponse) {
    return {
      ...base,
      phase: 'working',
      progress: 0.45,
      detail: 'Writing response',
    };
  }

  const subagents = latestActiveSubagentGroup(input.transcript);
  if (subagents?.status === 'running') {
    return {
      ...base,
      phase: 'subagents',
      progress: 0.7,
      detail: subagents.summary || `${subagents.agents.length} subagents running`,
      subagentCount: subagents.agents.length,
    };
  }

  const tool = latestRunningTool(input.transcript);
  if (tool) {
    const toolDisplay = liveActivityToolDisplay(tool.name);
    return {
      ...base,
      phase: 'tool',
      progress: 0.55,
      detail: toolDisplay.detail,
      currentTool: toolDisplay.badge,
    };
  }

  if (input.state.compacting) {
    return {
      ...base,
      phase: 'working',
      progress: 0.25,
      detail: 'Compacting context',
    };
  }

  if (input.state.queue.length > 0) {
    return {
      ...base,
      phase: 'working',
      progress: 0.15,
      detail: 'Queued',
    };
  }

  if (input.state.sending || Boolean(input.state.activeTurnId)) {
    return {
      ...base,
      phase: 'working',
      progress: 0.35,
      detail: 'Thinking',
    };
  }

  return { active: false, reason: 'idle' };
}

export function deriveMoxxyLiveActivityTransition(
  previous: MoxxyLiveActivitySnapshot | null,
  current: MoxxyLiveActivitySnapshot,
  transcript: ReadonlyArray<TranscriptItem>,
): MoxxyLiveActivityTransition {
  if (current.active) return { kind: 'start-or-update', snapshot: current };
  if (!previous?.active) return { kind: 'none' };
  if (current.reason === 'disconnected') return { kind: 'retain' };

  const failed = lastRenderedItem(transcript)?.kind === 'error' || latestSubagentGroup(transcript)?.status === 'failed';
  const snapshot: ActiveMoxxyLiveActivitySnapshot = {
    ...previous,
    phase: failed ? 'failed' : 'completed',
    progress: 1,
    detail: failed ? 'Failed' : 'Done',
    pendingCount: 0,
  };

  return {
    kind: 'end',
    snapshot,
    notification: failed
      ? {
          title: 'Moxxy needs attention',
          body: `${previous.title} stopped before completing.`,
        }
      : {
          title: 'Moxxy finished',
          body: `${previous.title} is ready.`,
        },
  };
}

export function planMoxxyLiveActivitySync(input: {
  readonly lastSent: MoxxyLiveActivitySnapshot | null;
  readonly next: MoxxyLiveActivitySnapshot;
  readonly now: number;
  readonly lastSentAt: number;
  readonly minUpdateMs: number;
}): MoxxyLiveActivitySyncPlan {
  if (!input.next.active) return { kind: 'skip' };
  if (!input.lastSent?.active) return { kind: 'send' };
  if (snapshotKey(input.lastSent) === snapshotKey(input.next)) return { kind: 'skip' };
  if (isUrgent(input.lastSent, input.next)) return { kind: 'send' };
  const dueAt = input.lastSentAt + input.minUpdateMs;
  if (input.now >= dueAt) return { kind: 'send' };
  return { kind: 'defer', dueAt };
}

export function selectMoxxyLiveActivityBackgroundFlush(input: {
  readonly pending: ActiveMoxxyLiveActivitySnapshot | null;
  readonly latestActive: ActiveMoxxyLiveActivitySnapshot | null;
}): ActiveMoxxyLiveActivitySnapshot | null {
  return input.pending ?? input.latestActive;
}

export function createMoxxyLiveActivityClient(options: {
  readonly nativeModule?: MoxxyLiveActivityNativeModule | null;
  readonly platformOS?: string;
}): MoxxyLiveActivityClient {
  const nativeModule = options.platformOS === 'ios' ? options.nativeModule : null;

  return {
    async isAvailable() {
      if (!nativeModule?.isAvailable) return false;
      return await nativeModule.isAvailable() === true;
    },
    async requestNotificationAuthorization() {
      if (!nativeModule?.requestNotificationAuthorization) return false;
      const result = await nativeModule.requestNotificationAuthorization();
      if (typeof result === 'boolean') return result;
      if (result && typeof result === 'object') {
        return (result as Record<string, unknown>).granted === true;
      }
      return false;
    },
    async startOrUpdate(snapshot) {
      if (!nativeModule?.startOrUpdate) return { active: false };
      const result = await nativeModule.startOrUpdate(snapshot);
      if (result && typeof result === 'object') {
        const record = result as Record<string, unknown>;
        return {
          active: record.active === true,
          activityId: textOrNull(record.activityId),
          pushToken: textOrNull(record.pushToken),
        };
      }
      return { active: true };
    },
    async end(snapshot) {
      if (!nativeModule?.end) return;
      await nativeModule.end(snapshot);
    },
    async notifyCompletion(notification) {
      if (!nativeModule?.notifyCompletion) return;
      await nativeModule.notifyCompletion(notification);
    },
  };
}

function snapshotKey(snapshot: MoxxyLiveActivitySnapshot): string {
  if (!snapshot.active) return `inactive:${snapshot.reason}`;
  return [
    snapshot.sessionId,
    snapshot.workspaceId,
    snapshot.title,
    snapshot.subtitle,
    snapshot.phase,
    snapshot.detail,
    snapshot.currentTool ?? '',
    snapshot.pendingCount,
    snapshot.subagentCount,
  ].join('\u0000');
}

function isUrgent(
  previous: ActiveMoxxyLiveActivitySnapshot,
  next: ActiveMoxxyLiveActivitySnapshot,
): boolean {
  if (next.phase === 'waiting' && previous.phase !== 'waiting') return true;
  if (next.phase === 'failed' || next.phase === 'completed') return true;
  if (previous.sessionId !== next.sessionId) return true;
  if (previous.workspaceId !== next.workspaceId) return true;
  if (previous.title !== next.title) return true;
  if (previous.subtitle !== next.subtitle) return true;
  return false;
}

function baseSnapshot(state: MobileState): ActiveMoxxyLiveActivitySnapshot {
  const session = state.session ?? {};
  const selectedSession = findRecordById(state.sessions, state.activeWorkspaceId);
  const sessionId = textOf(session.id, textOf(selectedSession?.id, state.activeWorkspaceId ?? 'workspace'));
  const workspaceId = textOf(
    selectedSession?.workspaceId,
    textOf(session.workspaceId, state.activeWorkspaceId ?? sessionId),
  );
  const workspace = findRecordById(state.workspaces, workspaceId);
  const title = truncate(
    textOf(
      selectedSession?.name,
      textOf(
        selectedSession?.firstPrompt,
        textOf(session.name, textOf(session.title, 'Moxxy is working')),
      ),
    ),
    48,
  );
  const subtitle = truncate(
    textOf(
      workspace?.name,
      textOf(
        workspace?.title,
        textOf(session.workspaceName, textOf(session.workspaceTitle, 'Moxxy')),
      ),
    ),
    48,
  );

  return {
    active: true,
    phase: 'working',
    progress: 0.35,
    sessionId,
    workspaceId,
    title,
    subtitle,
    detail: 'Thinking',
    pendingCount: 0,
    subagentCount: 0,
  };
}

function latestRunningTool(transcript: ReadonlyArray<TranscriptItem>): ToolGroupTranscriptItem['tools'][number] | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (isToolBoundary(item)) return null;
    if (item?.kind !== 'tool-group') continue;
    return item.tools.find((tool) => tool.status === 'running') ?? null;
  }
  return null;
}

function latestStreamingAssistant(transcript: ReadonlyArray<TranscriptItem>): TranscriptItem | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind === 'assistant') return item.streaming ? item : null;
    if (item?.kind === 'user' || item?.kind === 'error') return null;
  }
  return null;
}

function latestActiveSubagentGroup(transcript: ReadonlyArray<TranscriptItem>): SubagentGroupTranscriptItem | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (isToolBoundary(item)) return null;
    if (item?.kind === 'subagent-group') return item;
  }
  return null;
}

function latestSubagentGroup(transcript: ReadonlyArray<TranscriptItem>): SubagentGroupTranscriptItem | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind === 'subagent-group') return item;
  }
  return null;
}

function isToolBoundary(item: TranscriptItem | undefined): boolean {
  return item?.kind === 'assistant' || item?.kind === 'user' || item?.kind === 'error';
}

function lastRenderedItem(transcript: ReadonlyArray<TranscriptItem>): TranscriptItem | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item) return item;
  }
  return null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function liveActivityToolDisplay(name: string): { readonly badge: string; readonly detail: string } {
  const raw = name.trim() || 'Tool';
  const action = normalizedToolAction(raw);
  const lowerRaw = raw.toLowerCase();
  const lowerAction = action.toLowerCase();
  if (lowerAction === 'bash' || lowerRaw === 'bash' || lowerAction.includes('shell')) {
    return { badge: 'Bash', detail: 'Terminal · executing Bash' };
  }
  if (lowerRaw === 'web_fetch' || lowerAction === 'web fetch' || lowerAction.includes('web fetch')) {
    return { badge: 'Web', detail: 'Web · fetching' };
  }
  if (lowerAction.includes('web search') || lowerAction.includes('search web')) {
    return { badge: 'Web', detail: 'Web · searching' };
  }
  if (isMcpTool(raw)) {
    return {
      badge: mcpToolBadge(lowerRaw, lowerAction),
      detail: truncate(`MCP · ${action}`, 42),
    };
  }
  if (lowerAction === 'read' || lowerAction === 'write' || lowerAction === 'edit') {
    return { badge: 'Files', detail: `Files · ${fileToolVerb(lowerAction)}` };
  }
  if (lowerAction === 'grep' || lowerAction === 'glob') {
    return { badge: 'Search', detail: 'Files · searching' };
  }
  return {
    badge: truncate(titleBadge(action), 10),
    detail: truncate(`Tool · ${action}`, 42),
  };
}

function normalizedToolAction(name: string): string {
  const raw = name.trim() || 'Tool';
  const parts = raw.split('__').filter(Boolean);
  const value = parts.length >= 3 && parts[0] === 'mcp' ? parts[parts.length - 1]! : raw;
  return truncate(value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Tool', 30);
}

function isMcpTool(name: string): boolean {
  const parts = name.split('__').filter(Boolean);
  return parts.length >= 3 && parts[0] === 'mcp';
}

function mcpToolBadge(lowerRaw: string, lowerAction: string): string {
  if (lowerAction.includes('browser') || lowerAction.includes('navigate')) return 'Browser';
  if (lowerRaw.includes('pdf') || lowerAction.includes('pdf')) return 'PDF';
  if (lowerAction.includes('bash') || lowerAction.includes('shell')) return 'Bash';
  if (lowerAction.includes('read') || lowerAction.includes('write') || lowerAction.includes('file')) return 'Files';
  if (lowerAction.includes('search') || lowerAction.includes('fetch')) return 'Web';
  return 'MCP';
}

function titleBadge(value: string): string {
  const first = value.split(' ')[0] || 'Tool';
  return `${first.slice(0, 1).toUpperCase()}${first.slice(1)}`;
}

function fileToolVerb(action: string): string {
  if (action === 'read') return 'reading';
  if (action === 'write') return 'writing';
  return 'editing';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function findRecordById(
  records: ReadonlyArray<Record<string, unknown>>,
  id: string | null,
): Record<string, unknown> | null {
  if (!id) return null;
  return records.find((record) => textOf(record.id) === id) ?? null;
}

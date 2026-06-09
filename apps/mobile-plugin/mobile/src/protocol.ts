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

export type GatewayFrame =
  | { readonly type: 'reset' }
  | { readonly type: 'hello' }
  | { readonly type: 'snapshot'; readonly snapshot: Partial<MobileState> }
  | { readonly type: 'event'; readonly event: Record<string, unknown> }
  | { readonly type: 'permission.requested'; readonly permission: Record<string, unknown> }
  | { readonly type: 'permission.resolved'; readonly permissionId: string }
  | { readonly type: 'ask.request'; readonly ask: Record<string, unknown> }
  | { readonly type: 'ask.resolved'; readonly requestId: string }
  | { readonly type: 'connection'; readonly status: string; readonly activeWorkspaceId?: string; readonly autoApprove?: boolean; readonly commandName?: string }
  | { readonly type: 'transcribe.result'; readonly id?: string; readonly text: string }
  | { readonly type: 'error'; readonly message: string };

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

export function applyGatewayFrame(state: MobileState, frame: GatewayFrame): MobileState {
  switch (frame.type) {
    case 'reset':
      return emptyMobileState();
    case 'hello':
      return { ...state, connected: true };
    case 'snapshot':
      return {
        ...state,
        activeWorkspaceId: frame.snapshot.activeWorkspaceId ?? state.activeWorkspaceId,
        workspaces: frame.snapshot.workspaces ?? state.workspaces,
        sessions: frame.snapshot.sessions ?? state.sessions,
        session: frame.snapshot.session ?? state.session,
        agents: frame.snapshot.agents ?? state.agents,
        workflows: frame.snapshot.workflows ?? state.workflows,
        pendingPermissions: frame.snapshot.pendingPermissions ?? state.pendingPermissions,
        pendingAsks: frame.snapshot.pendingAsks ?? state.pendingAsks,
        commands: frame.snapshot.commands ?? state.commands,
        chatEvents: frame.snapshot.chatEvents ? dedupeChatEvents(frame.snapshot.chatEvents) : state.chatEvents,
        streamingText: frame.snapshot.streamingText ?? state.streamingText,
        sending: frame.snapshot.sending ?? state.sending,
        activeTurnId: frame.snapshot.activeTurnId ?? state.activeTurnId,
        queue: frame.snapshot.queue ?? state.queue,
        compacting: frame.snapshot.compacting ?? state.compacting,
        usage: frame.snapshot.usage ?? state.usage,
        autoApprove: frame.snapshot.autoApprove ?? state.autoApprove,
        activeMode: frame.snapshot.activeMode ?? state.activeMode,
        activeProvider: frame.snapshot.activeProvider ?? state.activeProvider,
        modeBadge: frame.snapshot.modeBadge ?? state.modeBadge,
      };
    case 'event':
      if (!eventTargetsActiveSelection(state, frame.event)) {
        return markTargetUnread(state, eventTargetIds(frame.event)[0] ?? null);
      }
      return { ...state, chatEvents: appendChatEvent(state.chatEvents, frame.event) };
    case 'permission.requested':
      return {
        ...state,
        pendingPermissions: upsertById(state.pendingPermissions, frame.permission),
      };
    case 'permission.resolved':
      return {
        ...state,
        pendingPermissions: state.pendingPermissions.filter((item) => item.id !== frame.permissionId),
      };
    case 'ask.request':
      return {
        ...state,
        pendingAsks: upsertByKey(state.pendingAsks, frame.ask, 'requestId'),
      };
    case 'ask.resolved':
      return {
        ...state,
        pendingAsks: state.pendingAsks.filter((item) => item.requestId !== frame.requestId),
      };
    case 'connection':
      if (frame.status === 'workspace.selected' && frame.activeWorkspaceId) {
        return {
          ...state,
          activeWorkspaceId: frame.activeWorkspaceId,
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === frame.activeWorkspaceId ? { ...workspace, unread: false } : workspace,
          ),
        };
      }
      if (frame.status === 'auto-approve.updated' && typeof frame.autoApprove === 'boolean') {
        return { ...state, autoApprove: frame.autoApprove };
      }
      if (frame.commandName === 'compact') {
        if (frame.status === 'command.started') return { ...state, compacting: true };
        if (frame.status === 'command.completed' || frame.status === 'command.failed') return { ...state, compacting: false };
      }
      if (frame.status === 'transcribe.accepted') {
        return { ...state, transcribing: true };
      }
      return state;
    case 'transcribe.result':
      return {
        ...state,
        transcriptionId: frame.id ?? `transcribe-${Date.now()}`,
        transcriptionText: frame.text,
        transcribing: false,
      };
    case 'error':
      return { ...state, transcribing: false, errors: [...state.errors, frame.message] };
  }
}

function eventTargetsActiveSelection(state: MobileState, event: Record<string, unknown>): boolean {
  const targets = eventTargetIds(event);
  if (targets.length === 0) return true;
  const activeIds = new Set<string>();
  if (state.activeWorkspaceId) activeIds.add(state.activeWorkspaceId);
  const selectedSession = state.session ?? state.sessions.find((session) => session.id === state.activeWorkspaceId);
  if (typeof selectedSession?.id === 'string') activeIds.add(selectedSession.id);
  if (typeof selectedSession?.workspaceId === 'string') activeIds.add(selectedSession.workspaceId);
  return targets.some((target) => activeIds.has(target));
}

function eventTargetIds(event: Record<string, unknown>): string[] {
  return [event.sessionId, event.workspaceId]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function markTargetUnread(state: MobileState, targetId: string | null): MobileState {
  if (!targetId) return state;
  return {
    ...state,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === targetId || workspace.workspaceId === targetId ? { ...workspace, unread: true } : workspace,
    ),
    sessions: state.sessions.map((session) =>
      session.id === targetId || session.workspaceId === targetId ? { ...session, unread: true } : session,
    ),
  };
}

function appendChatEvent(
  events: ReadonlyArray<Record<string, unknown>>,
  next: Record<string, unknown>,
): ReadonlyArray<Record<string, unknown>> {
  const id = eventId(next);
  if (id && events.some((event) => eventId(event) === id)) return events;
  return [...events, next];
}

function dedupeChatEvents(
  events: ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<Record<string, unknown>> {
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const event of events) {
    const id = eventId(event);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    deduped.push(event);
  }
  return deduped;
}

function eventId(event: Record<string, unknown>): string | null {
  return typeof event.id === 'string' && event.id.length > 0 ? event.id : null;
}

function upsertById(
  list: ReadonlyArray<Record<string, unknown>>,
  next: Record<string, unknown>,
): ReadonlyArray<Record<string, unknown>> {
  return upsertByKey(list, next, 'id');
}

function upsertByKey(
  list: ReadonlyArray<Record<string, unknown>>,
  next: Record<string, unknown>,
  key: string,
): ReadonlyArray<Record<string, unknown>> {
  if (typeof next[key] !== 'string') return [...list, next];
  const index = list.findIndex((item) => item[key] === next[key]);
  if (index === -1) return [...list, next];
  return list.map((item, itemIndex) => (itemIndex === index ? next : item));
}

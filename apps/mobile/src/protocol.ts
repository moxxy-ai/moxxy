export interface MobileModeBadgeSnapshot {
  readonly label: string;
  readonly tone?: 'attention' | 'info';
}

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
  readonly modeBadge: MobileModeBadgeSnapshot | null;
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

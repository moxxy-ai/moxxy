export interface BottomTabItem {
  readonly href: '/chat' | '/sessions' | '/permissions' | '/goals' | '/settings';
  readonly label: 'Chat' | 'Sessions' | 'Actions' | 'Goals' | 'Settings';
  readonly icon: 'message' | 'sessions' | 'actions' | 'goals' | 'settings';
  readonly badge: string | null;
}

export interface MobileMenuItem {
  readonly kind: 'link' | 'command';
  readonly href?: '/settings' | '/workflows';
  readonly command?: 'workflows';
  readonly commandArgs?: string;
  readonly label: 'Workflows' | 'Settings' | 'Gateway';
  readonly icon: 'workflows' | 'settings' | 'gateway';
  readonly badge: string | null;
}

export interface RecentMenuSession {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly active: boolean;
  readonly live: boolean;
  readonly readOnly: boolean;
  readonly dotTone: 'active' | 'muted';
  readonly statusLabel: 'Active' | null;
}

export interface WorkspaceMenuSession {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly active: boolean;
  readonly live: boolean;
  readonly readOnly: boolean;
  readonly lastActivity: string;
  readonly shortcutLabel: string | null;
}

export interface WorkspaceMenuSection {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly color: string;
  readonly active: boolean;
  readonly latestActivity: string;
  readonly sessions: ReadonlyArray<WorkspaceMenuSession>;
}

export interface QuickActionItem {
  readonly id: 'goal' | 'autoApprove' | 'compact' | 'newSession';
  readonly label: string;
  readonly icon: 'goals' | 'bolt' | 'actions' | 'plus';
  readonly active: boolean;
}

export interface ReturnToChatAction {
  readonly href: '/chat';
  readonly label: 'Chat';
  readonly icon: 'message';
}

const BASE_TABS: ReadonlyArray<Omit<BottomTabItem, 'badge'>> = [
  { href: '/chat', label: 'Chat', icon: 'message' },
  { href: '/sessions', label: 'Sessions', icon: 'sessions' },
  { href: '/permissions', label: 'Actions', icon: 'actions' },
  { href: '/goals', label: 'Goals', icon: 'goals' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export function buildBottomTabs(pendingActions = 0): BottomTabItem[] {
  return BASE_TABS.map((tab) => ({
    ...tab,
    badge: tab.href === '/permissions' && pendingActions > 0 ? String(pendingActions) : null,
  }));
}

const MENU_ITEMS: ReadonlyArray<Omit<MobileMenuItem, 'badge'>> = [
  { kind: 'link', href: '/workflows', label: 'Workflows', icon: 'workflows' },
  { kind: 'link', href: '/settings', label: 'Settings', icon: 'settings' },
  { kind: 'link', href: '/settings', label: 'Gateway', icon: 'gateway' },
];

export function buildMobileMenuItems(_pendingActions = 0): MobileMenuItem[] {
  return MENU_ITEMS.map((item) => ({
    ...item,
    badge: null,
  }));
}

export function buildRecentMenuSessions(
  sessions: ReadonlyArray<Record<string, unknown>>,
  activeSessionId: string | null,
  limit = Number.POSITIVE_INFINITY,
): RecentMenuSession[] {
  return sessions
    .filter(hasVisibleSessionContext)
    .slice(0, limit)
    .map((session, index) => {
      const id = stringOf(session.id, `session-${index}`);
      return {
        id,
        title: stringOf(session.firstPrompt, stringOf(session.name, id)),
        subtitle: stringOf(session.cwd, ''),
        active: id === activeSessionId,
        live: session.live === true,
        readOnly: session.readOnly === true,
        dotTone: id === activeSessionId ? 'active' : 'muted',
        statusLabel: id === activeSessionId ? 'Active' : null,
      };
    });
}

export function filterRecentMenuSessions(
  sessions: ReadonlyArray<RecentMenuSession>,
  query: string,
): RecentMenuSession[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...sessions];
  return sessions.filter((session) => {
    const haystack = `${session.title} ${session.subtitle}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

export function buildWorkspaceMenuSections(
  workspaces: ReadonlyArray<Record<string, unknown>>,
  sessions: ReadonlyArray<Record<string, unknown>>,
  activeSessionId: string | null,
): WorkspaceMenuSection[] {
  const realSections = workspaces
    .filter(isVisibleWorkspace)
    .map((workspace, index) => ({
      id: stringOf(workspace.id, `workspace-${index}`),
      title: stringOf(workspace.name, stringOf(workspace.title, `Workspace ${index + 1}`)),
      subtitle: stringOf(workspace.cwd, ''),
      color: stringOf(workspace.color, '#ec4899'),
      sessions: [] as WorkspaceMenuSession[],
    }));
  const byWorkspace = new Map<string, {
    id: string;
    title: string;
    subtitle: string;
    color: string;
    sessions: WorkspaceMenuSession[];
  }>(realSections.map((section) => [section.id, section]));
  const workspaceByCwd = new Map(
    realSections
      .filter((section) => section.subtitle.length > 0)
      .map((section) => [section.subtitle, section.id]),
  );
  const others = {
    id: 'others',
    title: 'Others',
    subtitle: 'Sessions outside desktop workspaces',
    color: '#94a3b8',
    sessions: [] as WorkspaceMenuSession[],
  };

  for (const raw of sessions.filter(hasVisibleSessionContext)) {
    const id = stringOf(raw.id, '');
    if (!id) continue;
    const cwd = stringOf(raw.cwd, '');
    const rawWorkspaceId = stringOf(raw.workspaceId, '');
    const workspaceId = byWorkspace.has(rawWorkspaceId) ? rawWorkspaceId : workspaceByCwd.get(cwd) ?? 'others';
    const workspace = byWorkspace.get(workspaceId) ?? others;
    workspace.sessions.push({
      id,
      title: stringOf(raw.firstPrompt, stringOf(raw.name, id)),
      subtitle: cwd,
      active: id === activeSessionId,
      live: raw.live === true,
      readOnly: raw.readOnly === true,
      lastActivity: stringOf(raw.lastActivity, ''),
      shortcutLabel: null,
    });
    if (workspace.id === 'others') byWorkspace.set('others', workspace);
  }

  const sortedSections = [...byWorkspace.values()]
    .map((workspace) => {
      const sortedSessions = [...workspace.sessions]
        .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
      return {
        ...workspace,
        active: sortedSessions.some((session) => session.active),
        latestActivity: sortedSessions[0]?.lastActivity ?? '',
        sessions: sortedSessions,
      };
    })
    .filter((section) => section.sessions.length > 0 || section.id !== 'others');

  return sortedSections;
}

export function filterWorkspaceMenuSections(
  sections: ReadonlyArray<WorkspaceMenuSection>,
  query: string,
): WorkspaceMenuSection[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...sections];
  return sections
    .map((section) => {
      const sectionMatches = `${section.title} ${section.subtitle}`.toLowerCase().includes(normalized);
      const sessions = sectionMatches
        ? section.sessions
        : section.sessions.filter((session) =>
            `${session.title} ${session.subtitle}`.toLowerCase().includes(normalized),
          );
      return sessions.length > 0 ? { ...section, sessions } : null;
    })
    .filter((section): section is WorkspaceMenuSection => section !== null);
}

export function buildInitialCollapsedWorkspaceIds(
  sections: ReadonlyArray<WorkspaceMenuSection>,
  maxExpanded = 3,
  maxSessionsWhenExpanded = 12,
): string[] {
  const expanded = new Set<string>();
  for (const section of sections) {
    if (section.active) expanded.add(section.id);
  }
  for (const section of sections) {
    if (expanded.size >= maxExpanded) break;
    expanded.add(section.id);
  }
  return sections
    .filter((section) => {
      if (section.sessions.length > maxSessionsWhenExpanded) return true;
      if (!expanded.has(section.id)) return true;
      return false;
    })
    .map((section) => section.id);
}

function hasVisibleSessionContext(session: Record<string, unknown>): boolean {
  if (session.live === true) return true;
  const eventCount = typeof session.eventCount === 'number' ? session.eventCount : 0;
  return eventCount > 0 && stringOf(session.firstPrompt, stringOf(session.name, '')).trim().length > 0;
}

function isVisibleWorkspace(workspace: Record<string, unknown>): boolean {
  return stringOf(workspace.id, '').length > 0 && stringOf(workspace.name, stringOf(workspace.title, '')).trim().length > 0;
}

function stringOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function buildQuickActionItems(autoApprove = false): QuickActionItem[] {
  return [
    { id: 'goal', label: 'Start goal', icon: 'goals', active: false },
    {
      id: 'autoApprove',
      label: autoApprove ? 'Auto-approve ON' : 'Auto-approve',
      icon: 'bolt',
      active: autoApprove,
    },
    { id: 'compact', label: 'Compact context', icon: 'actions', active: false },
    { id: 'newSession', label: 'New session', icon: 'plus', active: false },
  ];
}

export function buildReturnToChatAction(): ReturnToChatAction {
  return {
    href: '/chat',
    label: 'Chat',
    icon: 'message',
  };
}

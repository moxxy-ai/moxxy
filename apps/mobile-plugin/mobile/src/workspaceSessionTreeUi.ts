import type { WorkspaceMenuSection, WorkspaceMenuSession } from './navigation';

export interface WorkspaceSessionTreeSessionState {
  readonly id: string;
  readonly title: string;
  readonly active: boolean;
  readonly statusLabel: 'Live' | null;
  readonly accessibilityLabel: string;
}

export interface WorkspaceSessionTreeSectionState {
  readonly id: string;
  readonly title: string;
  readonly color: string;
  readonly active: boolean;
  readonly expanded: boolean;
  readonly sessionCountLabel: string;
  readonly collapsedSummary: string | null;
  readonly toggleAccessibilityLabel: string;
  readonly visibleSessions: ReadonlyArray<WorkspaceSessionTreeSessionState>;
}

export interface WorkspaceSessionTreeState {
  readonly sections: ReadonlyArray<WorkspaceSessionTreeSectionState>;
}

export function buildWorkspaceSessionTreeState(
  sections: ReadonlyArray<WorkspaceMenuSection>,
  collapsedWorkspaceIds: ReadonlyArray<string>,
): WorkspaceSessionTreeState {
  const collapsed = new Set(collapsedWorkspaceIds);

  return {
    sections: sections.map((section) => {
      const expanded = !collapsed.has(section.id);
      const visibleSessions = expanded ? section.sessions.map(toSessionState) : [];
      return {
        id: section.id,
        title: section.title,
        color: section.color,
        active: section.active,
        expanded,
        sessionCountLabel: String(section.sessions.length),
        collapsedSummary: expanded ? null : buildCollapsedSummary(section.sessions.length),
        toggleAccessibilityLabel: `${expanded ? 'Collapse' : 'Expand'} workspace ${section.title}`,
        visibleSessions,
      };
    }),
  };
}

function toSessionState(session: WorkspaceMenuSession): WorkspaceSessionTreeSessionState {
  return {
    id: session.id,
    title: session.title,
    active: session.active,
    statusLabel: session.live ? 'Live' : null,
    accessibilityLabel: `Open session ${session.title}`,
  };
}

function buildCollapsedSummary(sessionCount: number): string {
  return `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} hidden`;
}

import { StyleSheet, Text, View } from 'react-native';
import type { WorkspaceMenuSection } from '@/navigation';
import { buildWorkspaceSessionTreeState } from '@/workspaceSessionTreeUi';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { PressableScale } from './primitives/motion';

interface WorkspaceSessionTreeProps {
  readonly sections: ReadonlyArray<WorkspaceMenuSection>;
  readonly collapsedWorkspaceIds: ReadonlyArray<string>;
  readonly variant?: 'screen' | 'menu';
  readonly showGlobalNewSession?: boolean;
  readonly showWorkspaceNewSession?: boolean;
  readonly emptyTitle?: string;
  readonly emptySubtitle?: string;
  readonly onSelectSession: (id: string) => void;
  readonly onToggleWorkspace: (workspaceId: string) => void;
  readonly onNewSession?: (workspaceId?: string) => void;
}

export function WorkspaceSessionTree({
  sections,
  collapsedWorkspaceIds,
  variant = 'screen',
  showGlobalNewSession = false,
  showWorkspaceNewSession = true,
  emptyTitle = 'No workspaces',
  emptySubtitle = 'Start Moxxy desktop or TUI to expose sessions.',
  onSelectSession,
  onToggleWorkspace,
  onNewSession,
}: WorkspaceSessionTreeProps) {
  const tree = buildWorkspaceSessionTreeState(sections, collapsedWorkspaceIds);
  const isScreen = variant === 'screen';

  if (tree.sections.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
        <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.treeRoot, isScreen ? styles.treeRootScreen : null]}>
      {tree.sections.map((section) => (
        <View key={section.id} style={isScreen ? styles.sectionScreen : styles.sectionMenu}>
          <View style={styles.workspaceRow}>
            <PressableScale
              accessibilityLabel={section.toggleAccessibilityLabel}
              accessibilityRole="button"
              scaleTo={0.98}
              style={styles.workspaceToggle}
              onPress={() => onToggleWorkspace(section.id)}
            >
              <View style={[styles.chevronBox, { transform: [{ rotate: section.expanded ? '0deg' : '-90deg' }] }]}>
                <MobileIcon name="chevronDown" size={15} strokeWidth={2.55} color={mobileInk.soft} />
              </View>
              <MobileIcon name="folder" size={21} strokeWidth={2.2} color={section.color} />
              <Text style={[styles.workspaceTitle, section.active ? styles.workspaceTitleActive : null]} numberOfLines={1}>
                {section.title}
              </Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{section.sessionCountLabel}</Text>
              </View>
            </PressableScale>
            {showWorkspaceNewSession && onNewSession ? (
              <PressableScale
                accessibilityLabel={`New session in ${section.title}`}
                accessibilityRole="button"
                scaleTo={0.9}
                style={styles.workspaceNewButton}
                onPress={() => onNewSession(section.id)}
              >
                <MobileIcon name="plus" size={18} strokeWidth={2.45} color="#db2777" />
              </PressableScale>
            ) : null}
          </View>

          {section.expanded ? (
            <View style={styles.sessionsList}>
              {section.visibleSessions.map((session) => (
                <PressableScale
                  key={session.id}
                  accessibilityLabel={session.accessibilityLabel}
                  accessibilityRole="button"
                  scaleTo={0.98}
                  style={[styles.sessionButton, session.active ? styles.sessionButtonActive : styles.sessionButtonInactive]}
                  onPress={() => onSelectSession(session.id)}
                >
                  <Text style={[styles.sessionTitle, session.active ? styles.sessionTitleActive : null]} numberOfLines={1}>
                    {session.title}
                  </Text>
                  {session.statusLabel ? (
                    <View style={styles.liveBadge}>
                      <Text style={styles.liveText}>{session.statusLabel}</Text>
                    </View>
                  ) : null}
                </PressableScale>
              ))}
            </View>
          ) : (
            <PressableScale
              accessibilityLabel={`Expand workspace ${section.title}`}
              accessibilityRole="button"
              scaleTo={0.98}
              style={styles.collapsedSummaryButton}
              onPress={() => onToggleWorkspace(section.id)}
            >
              <Text style={styles.collapsedSummaryText}>{section.collapsedSummary}</Text>
            </PressableScale>
          )}
        </View>
      ))}
      {showGlobalNewSession && onNewSession ? (
        <PressableScale
          accessibilityLabel="Create new session"
          accessibilityRole="button"
          scaleTo={0.97}
          style={styles.globalNewButton}
          onPress={() => onNewSession()}
        >
          <MobileIcon name="plus" size={17} strokeWidth={2.45} color="#db2777" />
          <Text style={styles.globalNewText}>New session</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chevronBox: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 24,
  },
  collapsedSummaryButton: {
    borderColor: 'rgba(226,228,240,0.9)',
    borderLeftWidth: 1,
    justifyContent: 'center',
    marginLeft: 32,
    minHeight: 40,
    paddingHorizontal: 16,
  },
  collapsedSummaryText: {
    color: mobileInk.soft,
    fontSize: 12,
    fontWeight: '700',
  },
  countBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(241,242,249,0.9)',
    borderRadius: 999,
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    color: mobileInk.soft,
    fontSize: 10,
    fontWeight: '900',
  },
  emptyCard: {
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 20,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    padding: 20,
    ...mobileElevation.sm,
  },
  emptySubtitle: {
    color: mobileInk.soft,
    fontSize: 13,
    marginTop: 4,
  },
  emptyTitle: {
    color: mobileInk.strong,
    fontSize: 15,
    fontWeight: '700',
  },
  globalNewButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 48,
  },
  globalNewText: {
    color: '#db2777',
    fontSize: 13,
    fontWeight: '900',
  },
  liveBadge: {
    backgroundColor: '#10b981',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  liveText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  sectionMenu: {
    marginBottom: 16,
  },
  sectionScreen: {
    paddingVertical: 4,
  },
  sessionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sessionButtonActive: {
    backgroundColor: '#fdf2f8',
    borderColor: '#db2777',
  },
  sessionButtonInactive: {
    borderColor: 'transparent',
  },
  sessionTitle: {
    color: mobileInk.soft,
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    minWidth: 0,
  },
  sessionTitleActive: {
    color: mobileInk.strong,
    fontWeight: '900',
  },
  sessionsList: {
    borderColor: 'rgba(226,228,240,0.9)',
    borderLeftWidth: 1,
    marginLeft: 32,
    paddingLeft: 12,
  },
  treeRoot: {
    gap: 4,
  },
  treeRootScreen: {
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 20,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    ...mobileElevation.md,
  },
  workspaceNewButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  workspaceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  workspaceTitle: {
    color: mobileInk.soft,
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    minWidth: 0,
  },
  workspaceTitleActive: {
    color: mobileInk.strong,
  },
  workspaceToggle: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: 4,
  },
});

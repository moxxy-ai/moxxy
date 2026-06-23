import { StyleSheet, Text, View } from 'react-native';
import type { WorkspaceMenuSection } from '@/navigation';
import { buildWorkspaceSessionTreeState } from '@/workspaceSessionTreeUi';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Appear, PressableScale, PulseDot } from './primitives/motion';

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
  const isMenu = variant === 'menu';

  if (tree.sections.length === 0) {
    return (
      <Appear from="up" distance={12}>
        <View style={styles.emptyCard}>
          <View style={styles.emptyBadge}>
            <MobileIcon name="folder" size={24} strokeWidth={2.3} color={mobileSurface.accentStrong} />
          </View>
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
        </View>
      </Appear>
    );
  }

  return (
    <View style={[styles.treeRoot, isScreen ? styles.treeRootScreen : null]}>
      {tree.sections.map((section) => (
        <View
          key={section.id}
          style={[
            isScreen ? styles.sectionScreen : styles.sectionMenu,
            isMenu ? styles.sectionMenuCard : null,
            isMenu && section.active ? styles.sectionMenuCardActive : null,
          ]}
        >
          <View style={styles.workspaceRow}>
            <PressableScale
              accessibilityLabel={section.toggleAccessibilityLabel}
              accessibilityRole="button"
              scaleTo={0.98}
              style={[styles.workspaceToggle, !isMenu && section.active ? styles.workspaceToggleActive : null]}
              onPress={() => onToggleWorkspace(section.id)}
            >
              <View style={[styles.chevronBox, { transform: [{ rotate: section.expanded ? '0deg' : '-90deg' }] }]}>
                <MobileIcon name="chevronDown" size={15} strokeWidth={2.55} color={mobileInk.soft} />
              </View>
              <View style={[styles.folderTile, section.active ? styles.folderTileActive : null]}>
                <MobileIcon
                  name="folder"
                  size={16}
                  strokeWidth={2.4}
                  color={section.active ? mobileSurface.accentStrong : mobileInk.muted}
                />
              </View>
              <Text style={[styles.workspaceTitle, section.active ? styles.workspaceTitleActive : null]} numberOfLines={1}>
                {section.title}
              </Text>
              <View style={[styles.countBadge, section.active ? styles.countBadgeActive : null]}>
                <Text style={[styles.countText, section.active ? styles.countTextActive : null]}>{section.sessionCountLabel}</Text>
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
                <MobileIcon name="plus" size={18} strokeWidth={2.55} color="#ffffff" />
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
                  <PulseDot
                    color={session.statusLabel ? '#16a34a' : session.active ? mobileSurface.accent : '#cbd2e1'}
                    size={8}
                    pulsing={Boolean(session.statusLabel) || session.active}
                  />
                  <Text style={[styles.sessionTitle, session.active ? styles.sessionTitleActive : null]} numberOfLines={1}>
                    {session.title}
                  </Text>
                  {session.statusLabel ? (
                    <View style={styles.liveBadge}>
                      <PulseDot color="#ffffff" size={6} pulsing />
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
          <MobileIcon name="plus" size={18} strokeWidth={2.55} color="#ffffff" />
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
    borderColor: mobileSurface.border,
    borderLeftWidth: 1,
    justifyContent: 'center',
    marginLeft: 32,
    minHeight: 40,
    paddingHorizontal: 16,
  },
  collapsedSummaryText: {
    color: mobileInk.soft,
    fontSize: 12,
    fontWeight: '600',
  },
  countBadge: {
    alignItems: 'center',
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countBadgeActive: {
    backgroundColor: mobileSurface.accent,
    borderColor: mobileSurface.accent,
  },
  countText: {
    color: mobileInk.soft,
    fontSize: 10,
    fontWeight: '800',
  },
  countTextActive: {
    color: '#ffffff',
  },
  emptyBadge: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 16,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    marginBottom: 16,
    width: 52,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    ...mobileFlat.card,
  },
  emptySubtitle: {
    color: mobileInk.soft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
    textAlign: 'center',
  },
  emptyTitle: {
    color: mobileInk.strong,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  folderTile: {
    alignItems: 'center',
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 9,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  folderTileActive: {
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
  },
  globalNewButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 50,
  },
  globalNewText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  liveBadge: {
    alignItems: 'center',
    backgroundColor: '#16a34a',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  liveText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  sectionMenu: {
    marginBottom: 8,
  },
  sectionMenuCard: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  sectionMenuCardActive: {
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
  },
  sectionScreen: {
    paddingVertical: 4,
  },
  sessionButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sessionButtonActive: {
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
  },
  sessionButtonInactive: {
    borderColor: 'transparent',
  },
  sessionTitle: {
    color: mobileInk.soft,
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
    minWidth: 0,
  },
  sessionTitleActive: {
    color: mobileSurface.accentStrong,
    fontWeight: '800',
  },
  sessionsList: {
    borderColor: mobileSurface.border,
    borderLeftWidth: 1,
    marginLeft: 32,
    paddingLeft: 12,
  },
  treeRoot: {
    gap: 4,
  },
  treeRootScreen: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    ...mobileFlat.card,
  },
  workspaceNewButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  workspaceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  workspaceTitle: {
    color: mobileInk.muted,
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    minWidth: 0,
  },
  workspaceTitleActive: {
    color: mobileInk.strong,
  },
  workspaceToggle: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    minWidth: 0,
    paddingHorizontal: 6,
  },
  workspaceToggleActive: {
    backgroundColor: mobileSurface.accentSoft,
  },
});

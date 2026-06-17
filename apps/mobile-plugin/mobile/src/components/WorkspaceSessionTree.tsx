import { Pressable, Text, View } from 'react-native';
import type { WorkspaceMenuSection } from '@/navigation';
import { buildWorkspaceSessionTreeState } from '@/workspaceSessionTreeUi';
import { MobileIcon } from './MobileIcon';

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
      <View className="rounded-card border border-cardBorder bg-cardBg p-5">
        <Text className="text-[15px] font-bold text-text">{emptyTitle}</Text>
        <Text className="mt-1 text-[13px] text-muted">{emptySubtitle}</Text>
      </View>
    );
  }

  return (
    <View className={isScreen ? 'gap-1 rounded-card border border-cardBorder bg-cardBg px-2 py-2 shadow-card' : 'gap-1'}>
      {tree.sections.map((section) => (
        <View key={section.id} className={isScreen ? 'py-1' : 'mb-4'}>
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityLabel={section.toggleAccessibilityLabel}
              accessibilityRole="button"
              className="min-h-11 min-w-0 flex-1 flex-row items-center gap-2 rounded-block px-1"
              onPress={() => onToggleWorkspace(section.id)}
            >
              <View className="h-7 w-6 items-center justify-center" style={{ transform: [{ rotate: section.expanded ? '0deg' : '-90deg' }] }}>
                <MobileIcon name="chevronDown" size={15} strokeWidth={2.55} color="#64748b" />
              </View>
              <MobileIcon name="folder" size={21} strokeWidth={2.2} color={section.color} />
              <Text className={`min-w-0 flex-1 text-[17px] font-black ${section.active ? 'text-text' : 'text-muted'}`} numberOfLines={1}>
                {section.title}
              </Text>
              <View className="min-w-7 items-center rounded-pill bg-appBg px-2 py-0.5">
                <Text className="text-[10px] font-black text-muted">{section.sessionCountLabel}</Text>
              </View>
            </Pressable>
            {showWorkspaceNewSession && onNewSession ? (
              <Pressable
                accessibilityLabel={`New session in ${section.title}`}
                accessibilityRole="button"
                className="h-10 w-10 items-center justify-center rounded-pill"
                onPress={() => onNewSession(section.id)}
              >
                <MobileIcon name="plus" size={18} strokeWidth={2.45} color="#db2777" />
              </Pressable>
            ) : null}
          </View>

          {section.expanded ? (
            <View className="ml-8 border-l border-cardBorder pl-3">
              {section.visibleSessions.map((session) => (
                <Pressable
                  key={session.id}
                  accessibilityLabel={session.accessibilityLabel}
                  accessibilityRole="button"
                  className={`min-h-12 flex-row items-center gap-2 rounded-block px-3 py-2 ${
                    session.active ? 'border border-primary bg-primarySoft' : 'border border-transparent'
                  }`}
                  onPress={() => onSelectSession(session.id)}
                >
                  <Text className={`min-w-0 flex-1 text-[16px] leading-6 ${session.active ? 'font-black text-text' : 'font-semibold text-muted'}`} numberOfLines={1}>
                    {session.title}
                  </Text>
                  {session.statusLabel ? (
                    <View className="rounded-pill bg-green px-2 py-0.5">
                      <Text className="text-[10px] font-black text-white">{session.statusLabel}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : (
            <Pressable
              accessibilityLabel={`Expand workspace ${section.title}`}
              accessibilityRole="button"
              className="ml-8 min-h-10 justify-center rounded-block border-l border-cardBorder px-4"
              onPress={() => onToggleWorkspace(section.id)}
            >
              <Text className="text-[12px] font-bold text-muted">{section.collapsedSummary}</Text>
            </Pressable>
          )}
        </View>
      ))}
      {showGlobalNewSession && onNewSession ? (
        <Pressable
          accessibilityLabel="Create new session"
          accessibilityRole="button"
          className="mt-2 min-h-12 flex-row items-center justify-center gap-2 rounded-block border border-cardBorder bg-appBg"
          onPress={() => onNewSession()}
        >
          <MobileIcon name="plus" size={17} strokeWidth={2.45} color="#db2777" />
          <Text className="text-[13px] font-black text-muted">New session</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

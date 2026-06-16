import { Pressable, Text, View } from 'react-native';
import type { WorkspaceMenuSection } from '@/navigation';
import { SessionRow } from './SessionRow';

interface SessionListProps {
  readonly sections: ReadonlyArray<WorkspaceMenuSection>;
  readonly onSelectSession: (id: string) => void;
  readonly onNewSession: () => void;
}

export function SessionList(props: SessionListProps) {
  return (
    <View className="gap-3">
      {props.sections.length === 0 ? (
        <View className="rounded-card border border-cardBorder bg-cardBg p-5">
          <Text className="text-[15px] font-bold text-text">No workspaces</Text>
          <Text className="mt-1 text-[13px] text-muted">Start Moxxy desktop or TUI to expose sessions.</Text>
        </View>
      ) : null}
      {props.sections.map((workspace) => {
        return (
          <View key={workspace.id} className="gap-2 rounded-card border border-cardBorder bg-cardBg p-3">
            <View className="px-1">
              <Text className="text-[15px] font-black text-text">{workspace.title}</Text>
              {workspace.subtitle ? <Text className="mt-1 text-[12px] text-muted">{workspace.subtitle}</Text> : null}
            </View>
            {workspace.sessions.map((session) => (
              <SessionRow
                key={session.id}
                workspace={{
                  id: session.id,
                  firstPrompt: session.title,
                  cwd: session.subtitle,
                  live: session.live,
                  readOnly: session.readOnly,
                  lastActivity: session.lastActivity,
                }}
                active={session.active}
                onPress={props.onSelectSession}
              />
            ))}
          </View>
        );
      })}
      <Pressable
        accessibilityLabel="Create new session"
        accessibilityRole="button"
        className="min-h-12 items-center justify-center rounded-card border border-cardBorder bg-cardBg"
        onPress={props.onNewSession}
      >
        <Text className="text-[13px] font-bold text-muted">New session</Text>
      </Pressable>
    </View>
  );
}

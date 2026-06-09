import { Pressable, Text, View } from 'react-native';
import { SessionRow } from './SessionRow';

interface SessionListProps {
  readonly workspaces: ReadonlyArray<Record<string, unknown>>;
  readonly activeWorkspaceId: string | null;
  readonly onSelectWorkspace: (id: string) => void;
  readonly onNewSession: () => void;
}

export function SessionList(props: SessionListProps) {
  return (
    <View className="gap-3">
      {props.workspaces.length === 0 ? (
        <View className="rounded-card border border-cardBorder bg-cardBg p-5">
          <Text className="text-[15px] font-bold text-text">No workspaces</Text>
          <Text className="mt-1 text-[13px] text-muted">Start Moxxy desktop or TUI to expose sessions.</Text>
        </View>
      ) : null}
      {props.workspaces.map((workspace, index) => {
        const id = typeof workspace.id === 'string' ? workspace.id : `workspace-${index}`;
        return (
          <SessionRow
            key={id}
            workspace={workspace}
            active={props.activeWorkspaceId === id}
            onPress={props.onSelectWorkspace}
          />
        );
      })}
      <Pressable className="min-h-12 items-center justify-center rounded-card border border-cardBorder bg-cardBg" onPress={props.onNewSession}>
        <Text className="text-[13px] font-bold text-muted">New session</Text>
      </Pressable>
    </View>
  );
}

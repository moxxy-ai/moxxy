import { Pressable, Text, View } from 'react-native';
import { boolOf, recordId, textOf } from '@/utils/record';
import { buildSessionRowAccessibility } from '@/sessionRowUi';

interface SessionRowProps {
  readonly workspace: Record<string, unknown>;
  readonly active: boolean;
  readonly onPress: (id: string) => void;
}

export function SessionRow({ workspace, active, onPress }: SessionRowProps) {
  const id = recordId(workspace, '');
  const name = textOf(workspace.firstPrompt, textOf(workspace.name, textOf(workspace.label, 'Workspace')));
  const cwd = textOf(workspace.cwd, textOf(workspace.path, ''));
  const unread = boolOf(workspace.unread);
  const live = boolOf(workspace.live);
  const readOnly = boolOf(workspace.readOnly);
  const eventCount = typeof workspace.eventCount === 'number' ? workspace.eventCount : null;
  const lastActivity = textOf(workspace.lastActivity);
  const accessibility = buildSessionRowAccessibility(workspace);

  return (
    <Pressable
      accessibilityLabel={accessibility.accessibilityLabel}
      accessibilityRole={accessibility.accessibilityRole}
      className={`min-h-16 rounded-card border px-4 py-3 ${
        active ? 'border-primary bg-primarySoft' : 'border-cardBorder bg-cardBg'
      }`}
      onPress={() => id && onPress(id)}
    >
      <View className="flex-row items-center gap-3">
        <View className={`h-2.5 w-2.5 rounded-pill ${unread ? 'bg-primary' : active ? 'bg-green' : 'bg-cardBorderStrong'}`} />
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-bold text-text">{name}</Text>
          {cwd ? <Text className="truncate text-[12px] text-muted">{cwd}</Text> : null}
          <View className="mt-2 flex-row flex-wrap gap-1.5">
            {eventCount !== null ? <Badge label={`${eventCount} events`} /> : null}
            {lastActivity ? <Badge label={formatDate(lastActivity)} /> : null}
            {live ? <Badge label="Live" active /> : null}
            {readOnly ? <Badge label="Archive" /> : null}
          </View>
        </View>
        {active ? <Text className="text-[11px] font-bold text-primaryStrong">Active</Text> : null}
      </View>
    </Pressable>
  );
}

function Badge({ label, active }: { readonly label: string; readonly active?: boolean }) {
  return (
    <View className={`rounded-pill px-2 py-0.5 ${active ? 'bg-green' : 'bg-appBg'}`}>
      <Text className={`text-[10px] font-bold ${active ? 'text-white' : 'text-muted'}`}>{label}</Text>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });
}

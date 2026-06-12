import { Pressable, Text, View } from 'react-native';
import { textOf } from '@/utils/record';
import { permissionResponseForAction } from '../permissionResponse';
import { MobileIcon } from './MobileIcon';

interface PermissionCardProps {
  readonly ask: Record<string, unknown>;
  readonly onRespond: (response: Record<string, unknown>) => void;
}

export function PermissionCard({ ask, onRespond }: PermissionCardProps) {
  const tool = isRecord(ask.tool) ? ask.tool : ask;
  const name = textOf(tool.name, textOf(ask.title, 'Permission required'));
  const description = textOf(tool.description, textOf(ask.description, textOf(ask.reason, 'The agent needs approval.')));

  return (
    <View className="gap-3 rounded-card border border-cardBorder bg-cardBg p-3 shadow-card">
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-block bg-primarySoft">
          <MobileIcon name="actions" size={17} strokeWidth={2.35} color="#db2777" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-bold text-text" numberOfLines={1}>{name}</Text>
          <Text className="mt-1 text-[13px] leading-5 text-muted">{description}</Text>
        </View>
      </View>
      <View className="flex-row flex-wrap justify-end gap-2">
        <DecisionButton label="Deny" tone="danger" onPress={() => onRespond(permissionResponseForAction('deny'))} />
        <DecisionButton label="Allow once" tone="primary" onPress={() => onRespond(permissionResponseForAction('allow_once'))} />
        <DecisionButton label="Allow session" onPress={() => onRespond(permissionResponseForAction('allow_session'))} />
        <DecisionButton label="Always allow" onPress={() => onRespond(permissionResponseForAction('allow_always'))} />
      </View>
    </View>
  );
}

function DecisionButton({
  label,
  tone = 'neutral',
  onPress,
}: {
  readonly label: string;
  readonly tone?: 'neutral' | 'primary' | 'danger';
  readonly onPress: () => void;
}) {
  const cls = tone === 'primary'
    ? 'border-primary bg-primary'
    : tone === 'danger'
      ? 'border-cardBorder bg-cardBg'
      : 'border-cardBorder bg-cardBg';
  const textCls = tone === 'primary'
    ? 'text-white'
    : tone === 'danger'
      ? 'text-red'
      : 'text-muted';
  return (
    <Pressable className={`min-h-9 justify-center rounded-block border px-3 ${cls}`} onPress={onPress}>
      <Text className={`text-[13px] font-bold ${textCls}`}>{label}</Text>
    </Pressable>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

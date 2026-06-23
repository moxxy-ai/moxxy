import { sx, mobileInk, mobileSurface } from '../styles/tokens';
import { StyleSheet, Text, View } from 'react-native';
import { textOf } from '@/utils/record';
import { permissionResponseForAction } from '../permissionResponse';
import { MobileIcon } from './MobileIcon';
import { GlassSheet } from './primitives/GlassSheet';
import { PressableScale } from './primitives/motion';

interface PermissionCardProps {
  readonly ask: Record<string, unknown>;
  readonly onRespond: (response: Record<string, unknown>) => void;
}

export function PermissionCard({ ask, onRespond }: PermissionCardProps) {
  const tool = isRecord(ask.tool) ? ask.tool : ask;
  const name = textOf(tool.name, textOf(ask.title, 'Permission required'));
  const description = textOf(tool.description, textOf(ask.description, textOf(ask.reason, 'The agent needs approval.')));

  return (
    <GlassSheet radius={20} style={styles.sheet}>
      <View style={sx('flex-row items-start gap-3')}>
        <View style={styles.iconBadge}>
          <MobileIcon name="actions" size={17} strokeWidth={2.35} color={mobileSurface.accentStrong} />
        </View>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[15px] font-bold', { color: mobileInk.strong })} numberOfLines={1}>{name}</Text>
          <Text style={sx('mt-1 text-[13px] leading-5', { color: mobileInk.soft })}>{description}</Text>
        </View>
      </View>
      <View style={sx('flex-row flex-wrap justify-end gap-2')}>
        <DecisionButton label="Deny" tone="danger" onPress={() => onRespond(permissionResponseForAction('deny'))} />
        <DecisionButton label="Allow once" tone="neutral" onPress={() => onRespond(permissionResponseForAction('allow_once'))} />
        <DecisionButton label="Allow session" tone="neutral" onPress={() => onRespond(permissionResponseForAction('allow_session'))} />
        <DecisionButton label="Always allow" tone="primary" onPress={() => onRespond(permissionResponseForAction('allow_always'))} />
      </View>
    </GlassSheet>
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
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      scaleTo={0.94}
      style={[
        styles.button,
        tone === 'primary' ? styles.buttonPrimary : tone === 'danger' ? styles.buttonDanger : styles.buttonNeutral,
      ]}
      onPress={onPress}
    >
      <Text
        style={[
          sx('text-[13px] font-bold'),
          { color: tone === 'primary' ? mobileInk.onBrand : tone === 'danger' ? '#ef4444' : mobileInk.muted },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  buttonDanger: {
    backgroundColor: mobileSurface.card,
    borderColor: '#fecdd3',
    borderWidth: 1,
  },
  buttonNeutral: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderWidth: 1,
  },
  buttonPrimary: {
    backgroundColor: mobileSurface.accent,
    minWidth: 112,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  sheet: {
    gap: 12,
    padding: 14,
  },
});

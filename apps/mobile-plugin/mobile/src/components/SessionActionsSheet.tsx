import { sx } from '../styles/tokens';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileSessionActionRow } from '../sessionActions';
import { MobileIcon } from './MobileIcon';

interface SessionActionsSheetProps {
  readonly open: boolean;
  readonly actions: ReadonlyArray<MobileSessionActionRow>;
  readonly allActionsCount: number;
  readonly filter: string;
  readonly error: string | null;
  readonly readOnly: boolean;
  readonly argsFor: MobileSessionActionRow | null;
  readonly argValues: Readonly<Record<string, string>>;
  readonly onFilterChange: (value: string) => void;
  readonly onSelectAction: (action: MobileSessionActionRow) => void;
  readonly onArgValueChange: (id: string, value: string) => void;
  readonly onRunArgsAction: () => void;
  readonly onBackToList: () => void;
  readonly onClose: () => void;
}

export function SessionActionsSheet(props: SessionActionsSheetProps) {
  if (!props.open) return null;

  return (
    <View
      style={{
        bottom: 0,
        left: 0,
        paddingBottom: 96,
        paddingHorizontal: 16,
        paddingTop: 76,
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: 70,
      }}
    >
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel="Close session actions"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.28)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }}
        onPress={props.onClose}
      />
      <View
        style={sx('rounded-card border border-cardBorder bg-cardBg shadow-card', {
          borderRadius: 20,
          maxHeight: '100%',
          padding: 16,
          shadowColor: '#0f172a',
          shadowOffset: { width: 0, height: 18 },
          shadowOpacity: 0.18,
          shadowRadius: 28,
        })}
      >
        {props.argsFor ? <ArgsView {...props} action={props.argsFor} /> : <ListView {...props} />}
      </View>
    </View>
  );
}

function ListView(props: SessionActionsSheetProps) {
  return (
    <View style={{ gap: 14 }}>
      <View style={sx('flex-row items-center justify-between gap-3')}>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[22px] font-black text-text')}>Actions</Text>
          <Text style={sx('mt-1 text-[12px] font-bold text-muted')}>
            {props.allActionsCount} available for this session
          </Text>
        </View>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Close actions"
          style={sx('h-10 w-10 items-center justify-center rounded-pill bg-appBg')}
          onPress={props.onClose}
        >
          <MobileIcon name="x" size={19} strokeWidth={2.35} color="#64748b" />
        </Pressable>
      </View>

      <TextInput
        accessibilityLabel="Filter actions"
        value={props.filter}
        onChangeText={props.onFilterChange}
        placeholder="Filter actions..."
        placeholderTextColor="#94a3b8"
        autoCapitalize="none"
        autoCorrect={false}
        style={sx('min-h-12 rounded-block border border-cardBorder bg-appBg px-4 text-[16px] font-semibold text-text')}
      />

      {props.error ? (
        <View style={sx('rounded-block bg-red/10 px-3 py-2')}>
          <Text style={sx('text-[12px] font-semibold text-red')}>{props.error}</Text>
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 410 }} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
        {props.actions.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            disabled={props.readOnly}
            onPress={() => props.onSelectAction(action)}
          />
        ))}
        {props.actions.length === 0 ? (
          <View style={sx('rounded-block border border-cardBorder bg-appBg px-4 py-4')}>
            <Text style={sx('text-[14px] font-black text-text')}>No actions match</Text>
            <Text style={sx('mt-1 text-[12px] font-semibold text-muted')}>Try a shorter filter.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ArgsView(props: SessionActionsSheetProps & { readonly action: MobileSessionActionRow }) {
  const canRun = props.action.args.every((arg) => (props.argValues[arg.id] ?? '').trim().length > 0);
  return (
    <View style={{ gap: 14 }}>
      <View style={sx('flex-row items-center justify-between gap-3')}>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[22px] font-black text-text')}>{props.action.label}</Text>
          <Text style={sx('mt-1 text-[12px] font-semibold text-muted')} numberOfLines={2}>
            {props.action.description}
          </Text>
        </View>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Close action arguments"
          style={sx('h-10 w-10 items-center justify-center rounded-pill bg-appBg')}
          onPress={props.onClose}
        >
          <MobileIcon name="x" size={19} strokeWidth={2.35} color="#64748b" />
        </Pressable>
      </View>

      <ScrollView style={{ maxHeight: 330 }} contentContainerStyle={{ gap: 12, paddingBottom: 2 }}>
        {props.action.args.map((arg) => (
          <View key={arg.id} style={{ gap: 6 }}>
            <Text style={sx('text-[12px] font-black uppercase tracking-widest text-muted')}>{arg.label}</Text>
            <TextInput
              accessibilityLabel={arg.label}
              value={props.argValues[arg.id] ?? ''}
              onChangeText={(value) => props.onArgValueChange(arg.id, value)}
              placeholder={arg.placeholder}
              placeholderTextColor="#94a3b8"
              multiline={arg.multiline}
              secureTextEntry={arg.id === 'value'}
              autoCapitalize="none"
              autoCorrect={false}
              style={sx('min-h-12 rounded-block border border-cardBorder bg-appBg px-4 py-3 text-[16px] font-semibold text-text', {
                maxHeight: arg.multiline ? 140 : undefined,
              })}
            />
          </View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Back to actions"
          style={sx('min-h-12 flex-1 items-center justify-center rounded-block border border-cardBorder bg-cardBg')}
          onPress={props.onBackToList}
        >
          <Text style={sx('text-[14px] font-black text-muted')}>Back</Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Run ${props.action.label}`}
          style={sx(canRun && !props.readOnly ? 'bg-primary' : 'bg-cardBorder', {
            alignItems: 'center',
            borderRadius: 12,
            flex: 1,
            justifyContent: 'center',
            minHeight: 48,
          })}
          disabled={!canRun || props.readOnly}
          onPress={props.onRunArgsAction}
        >
          <Text style={sx('text-[14px] font-black text-white')}>Run action</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ActionRow({
  action,
  disabled,
  onPress,
}: {
  readonly action: MobileSessionActionRow;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const toneColors =
    action.tone === 'destructive'
      ? { bg: '#fff1f2', border: '#fecdd3', text: '#ef4444' }
      : action.tone === 'attention'
        ? { bg: '#fff7ed', border: '#fed7aa', text: '#f59e0b' }
        : { bg: '#fcfcff', border: '#e3e5f0', text: '#0f172a' };

  return (
    <Pressable
      accessibilityLabel={`Run ${action.label}`}
      accessibilityRole="button"
      disabled={disabled}
      style={{
        backgroundColor: toneColors.bg,
        borderColor: toneColors.border,
        borderRadius: 14,
        borderWidth: 1,
        minHeight: 66,
        opacity: disabled ? 0.55 : 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
      onPress={onPress}
    >
      <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={sx('text-[16px] font-black', { color: toneColors.text })} numberOfLines={1}>
            {action.label}
          </Text>
          <Text style={sx('mt-1 text-[12px] font-semibold leading-4 text-muted')} numberOfLines={2}>
            {action.description}
          </Text>
        </View>
        {action.args.length > 0 ? (
          <View style={sx('rounded-pill bg-primarySoft px-2.5 py-1')}>
            <Text style={sx('text-[10px] font-black uppercase text-primaryStrong')}>Args</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

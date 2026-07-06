import { Fragment, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import type { ModelSelectorUiState } from '../modelSelector';
import type { ModeSelectorUiState } from '../modeSelector';
import type { MobileSessionActionRow } from '../sessionActions';
import { BottomSheet, Button, SheetGroup, SheetRow, Toggle } from '@/ui/kit';
import { MobileIcon } from './MobileIcon';

type Page = 'main' | 'model' | 'mode' | 'actions';

export interface ComposerSheetActions {
  readonly rows: ReadonlyArray<MobileSessionActionRow>;
  readonly allCount: number;
  readonly filter: string;
  readonly error: string | null;
  readonly argsFor: MobileSessionActionRow | null;
  readonly argValues: Readonly<Record<string, string>>;
  readonly readOnly: boolean;
  readonly onFilterChange: (value: string) => void;
  readonly onSelect: (action: MobileSessionActionRow) => void;
  readonly onArgChange: (id: string, value: string) => void;
  readonly onRunArgs: () => void;
  readonly onBack: () => void;
  readonly load: () => void;
  readonly reset: () => void;
}

interface ComposerSheetProps {
  readonly open: boolean;
  readonly autoApprove: boolean;
  readonly readOnly?: boolean;
  readonly modelUi: ModelSelectorUiState;
  readonly modeUi: ModeSelectorUiState;
  readonly actions: ComposerSheetActions;
  readonly onClose: () => void;
  readonly onPickImage: () => void;
  readonly onPickFile: () => void;
  readonly onSelectProvider: (provider: string) => void;
  readonly onPickModel: (provider: string, model: string | null) => void;
  readonly onPickMode: (mode: string) => void;
  readonly onGoal: () => void;
  readonly onToggleAutoApprove: () => void;
  readonly onCompact: () => void;
  readonly onNewSession: () => void;
}

export function ComposerSheet(props: ComposerSheetProps) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const pageHeight = Math.round(height * 0.62);
  const [page, setPage] = useState<Page>('main');

  useEffect(() => {
    if (props.open) setPage('main');
  }, [props.open]);

  const close = () => {
    props.actions.reset();
    props.onClose();
  };
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  // The image/file pickers present a native UI; iOS drops the presentation if
  // it fires while this sheet's Modal is still dismissing, so defer past the
  // close animation.
  const runDeferred = (fn: () => void) => () => {
    close();
    setTimeout(fn, 380);
  };
  const goActions = () => {
    props.actions.load();
    setPage('actions');
  };
  const backToMain = () => {
    props.actions.reset();
    setPage('main');
  };

  const inArgs = page === 'actions' && props.actions.argsFor;
  const title = page === 'model' ? 'Model' : page === 'mode' ? 'Mode' : page === 'actions' ? (inArgs ? inArgs.label : 'Actions') : 'Options';
  const back = page === 'main' ? undefined : inArgs ? props.actions.onBack : backToMain;

  return (
    <BottomSheet open={props.open} onClose={close} avoidKeyboard>
      <View style={sx('flex-row items-center px-3 pb-3', { gap: 4, minHeight: 40 })}>
        {back ? (
          <Pressable accessibilityLabel="Back" accessibilityRole="button" hitSlop={8} onPress={back} style={sx('h-9 w-9 items-center justify-center rounded-full')}>
            <MobileIcon name="chevronLeft" size={24} strokeWidth={2.6} color={colors.text} />
          </Pressable>
        ) : null}
        <Text style={sx('flex-1 text-[20px] font-black text-text', { letterSpacing: -0.3, paddingLeft: page === 'main' ? 13 : 2 })} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {page === 'main' ? (
        <ScrollView style={{ maxHeight: pageHeight }} contentContainerStyle={{ gap: 14, paddingBottom: 8, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
          <SheetGroup>
            <SheetRow icon="camera" iconTone="brand" label="Photo or screenshot" chevron onPress={runDeferred(props.onPickImage)} />
            <SheetRow icon="folder" iconTone="info" label="File from phone" chevron divider onPress={runDeferred(props.onPickFile)} />
          </SheetGroup>
          <SheetGroup>
            <SheetRow icon="agent" iconTone="brand" label="Model" value={props.modelUi.chipLabel} chevron disabled={props.modelUi.disabled} onPress={() => setPage('model')} />
            <SheetRow icon="bolt" iconTone="warn" label="Mode" value={props.modeUi.chipLabel} chevron divider disabled={props.modeUi.disabled} onPress={() => setPage('mode')} />
          </SheetGroup>
          <SheetGroup>
            <SheetRow icon="actions" iconTone="info" label="Session actions" chevron onPress={goActions} />
            <SheetRow icon="goals" iconTone="brand" label="Start a goal" chevron divider onPress={run(props.onGoal)} />
            <SheetRow
              icon="bolt"
              iconTone={props.autoApprove ? 'success' : 'neutral'}
              label="Auto-approve tool calls"
              divider
              onPress={props.onToggleAutoApprove}
              trailing={<Toggle value={props.autoApprove} onValueChange={props.onToggleAutoApprove} />}
            />
            <SheetRow icon="refresh" iconTone="neutral" label="Compact context" chevron divider onPress={run(props.onCompact)} />
            <SheetRow icon="plus" iconTone="neutral" label="New chat" chevron divider onPress={run(props.onNewSession)} />
          </SheetGroup>
        </ScrollView>
      ) : page === 'model' ? (
        <ScrollView style={{ height: pageHeight }} contentContainerStyle={{ paddingBottom: 16, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
          <SheetGroup>
            {props.modelUi.providerRows.map((provider, providerIndex) => (
              <Fragment key={provider.id}>
                <SheetRow
                  dot={provider.active ? colors.green : colors.cardBorderStrong}
                  label={provider.label}
                  expanded={provider.selected}
                  divider={providerIndex > 0}
                  onPress={() => props.onSelectProvider(provider.id)}
                />
                {provider.selected
                  ? props.modelUi.modelRows.length > 0
                    ? props.modelUi.modelRows.map((model) => (
                        <SheetRow
                          key={model.id ?? 'default'}
                          label={model.label}
                          indent
                          divider
                          selected={model.active}
                          check={model.active}
                          onPress={() => { props.onPickModel(props.modelUi.selectedProvider, model.id); backToMain(); }}
                        />
                      ))
                    : (
                        <View style={sx('px-4 py-3', { borderTopColor: colors.cardBorder, borderTopWidth: 1, paddingLeft: 32 })}>
                          <Text style={sx('text-[13px] font-medium text-dim')}>No models advertised.</Text>
                        </View>
                      )
                  : null}
              </Fragment>
            ))}
          </SheetGroup>
        </ScrollView>
      ) : page === 'mode' ? (
        <ScrollView style={{ height: pageHeight }} contentContainerStyle={{ paddingBottom: 16, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
          <SheetGroup>
            {props.modeUi.modeRows.map((mode, index) => (
              <SheetRow
                key={mode.id}
                label={mode.label}
                selected={mode.active}
                check={mode.active}
                divider={index > 0}
                onPress={() => { props.onPickMode(mode.id); backToMain(); }}
              />
            ))}
          </SheetGroup>
        </ScrollView>
      ) : inArgs ? (
        <ActionArgs actions={props.actions} action={props.actions.argsFor!} onClose={close} />
      ) : (
        <ActionList actions={props.actions} height={pageHeight} onSelect={(action) => { props.actions.onSelect(action); if (action.args.length === 0) close(); }} />
      )}
    </BottomSheet>
  );
}

function ActionList({ actions, height, onSelect }: { readonly actions: ComposerSheetActions; readonly height: number; readonly onSelect: (action: MobileSessionActionRow) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ height }}>
      <View style={{ paddingBottom: 10, paddingHorizontal: 16 }}>
        <TextInput
          accessibilityLabel="Filter actions"
          value={actions.filter}
          onChangeText={actions.onFilterChange}
          placeholder="Filter actions…"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={sx('rounded-2xl px-4 text-[15px] font-semibold text-text', { backgroundColor: colors.inputSoft, borderColor: colors.cardBorder, borderWidth: 1, minHeight: 48 })}
        />
        {actions.error ? (
          <View style={sx('mt-2 rounded-xl px-3 py-2', { backgroundColor: colors.redSoft, borderColor: colors.redBorder, borderWidth: 1 })}>
            <Text style={sx('text-[12px] font-semibold', { color: colors.redText })}>{actions.error}</Text>
          </View>
        ) : null}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        {actions.rows.length > 0 ? (
          <SheetGroup>
            {actions.rows.map((action, index) => (
              <SheetRow
                key={action.id}
                label={action.label}
                sublabel={action.description}
                divider={index > 0}
                disabled={actions.readOnly}
                accent={action.tone === 'destructive' ? colors.red : action.tone === 'attention' ? colors.amber : undefined}
                trailing={action.args.length > 0 ? (
                  <View style={sx('rounded-pill px-2.5 py-1', { backgroundColor: colors.primarySoft })}>
                    <Text style={sx('text-[10px] font-black uppercase', { color: colors.primaryStrong })}>Args</Text>
                  </View>
                ) : undefined}
                chevron={action.args.length === 0}
                onPress={() => onSelect(action)}
              />
            ))}
          </SheetGroup>
        ) : (
          <View style={sx('items-center rounded-2xl px-4 py-8', { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: 1 })}>
            <Text style={sx('text-[14px] font-black text-text')}>No actions match</Text>
            <Text style={sx('mt-1 text-[13px] font-medium text-dim')}>Try a shorter filter.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ActionArgs({ actions, action, onClose }: { readonly actions: ComposerSheetActions; readonly action: MobileSessionActionRow; readonly onClose: () => void }) {
  const { colors } = useTheme();
  const canRun = !actions.readOnly && action.args.every((arg) => (actions.argValues[arg.id] ?? '').trim().length > 0);
  return (
    <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 12, paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {action.description ? <Text style={sx('text-[13px] font-medium text-dim', { lineHeight: 18 })}>{action.description}</Text> : null}
      {action.args.map((arg) => (
        <View key={arg.id} style={{ gap: 6 }}>
          <Text style={sx('text-[11px] font-black uppercase tracking-widest text-muted')}>{arg.label}</Text>
          <TextInput
            accessibilityLabel={arg.label}
            value={actions.argValues[arg.id] ?? ''}
            onChangeText={(value) => actions.onArgChange(arg.id, value)}
            placeholder={arg.placeholder}
            placeholderTextColor={colors.textDim}
            multiline={arg.multiline}
            secureTextEntry={arg.id === 'value'}
            autoCapitalize="none"
            autoCorrect={false}
            style={sx('rounded-2xl px-4 py-3 text-[15px] font-semibold text-text', { backgroundColor: colors.inputSoft, borderColor: colors.cardBorder, borderWidth: 1, maxHeight: arg.multiline ? 140 : undefined, minHeight: 48 })}
          />
        </View>
      ))}
      <Button label="Run action" disabled={!canRun} onPress={() => { actions.onRunArgs(); onClose(); }} />
    </ScrollView>
  );
}

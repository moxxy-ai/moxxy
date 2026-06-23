import { Text, View } from 'react-native';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { BottomSheet, Button, ListRow, Pill } from '@/ui/kit';
import type { ConnectionState } from '@/connectionState';
import type { PairingState } from '@/hooks/usePairing';

/** The one connection surface, reachable from the header status chip and the
 *  inline banner — always, regardless of connection state. Reconnect and
 *  Disconnect act directly; re-pairing (QR) lives on the Account screen, which
 *  hosts the proven screen-level scanner (avoids a scanner-modal-in-a-sheet). */
export function ConnectionSheet({
  open,
  onClose,
  state,
  pairing,
  onOpenSettings,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly state: ConnectionState;
  readonly pairing: PairingState;
  readonly onOpenSettings: () => void;
}) {
  const { colors } = useTheme();
  const online = state.status === 'connected' || state.status === 'read-only';

  return (
    <BottomSheet open={open} onClose={onClose} title="Connection">
      <View style={{ gap: 12, paddingBottom: 8, paddingHorizontal: 16 }}>
        <View style={sx('flex-row items-center justify-between', { gap: 12 })}>
          <Text style={sx('text-[15px] font-bold text-text')}>{state.banner.title}</Text>
          <Pill label={state.headerLabel} tone={online ? 'success' : state.status === 'offline' ? 'danger' : 'warn'} />
        </View>

        <Text style={sx('text-[13px] font-medium text-muted', { lineHeight: 19 })}>{state.banner.body}</Text>

        <ListRow icon="gateway" iconTone={online ? 'success' : 'neutral'} title="Gateway" subtitle={pairing.gatewayUrl || '—'} showChevron={false} />

        {pairing.error ? (
          <View style={sx('rounded-2xl', { backgroundColor: colors.redSoft, borderColor: colors.redBorder, borderWidth: 1, padding: 12 })}>
            <Text style={sx('text-[13px] font-medium', { color: colors.redText, lineHeight: 18 })}>{pairing.error}</Text>
          </View>
        ) : null}

        {state.banner.steps.length > 0 ? (
          <View style={sx('rounded-2xl px-4 py-3', { backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: 1, gap: 8 })}>
            {state.banner.steps.map((step, index) => (
              <View key={step} style={sx('flex-row items-center', { gap: 10 })}>
                <View style={sx('items-center justify-center rounded-full', { backgroundColor: colors.primarySoft, height: 22, width: 22 })}>
                  <Text style={sx('text-[11px] font-black text-primary')}>{index + 1}</Text>
                </View>
                <Text style={sx('flex-1 text-[13px] font-medium text-text', { lineHeight: 18 })}>{step}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={sx('mt-1', { gap: 10 })}>
          {!online ? (
            <Button label="Reconnect now" icon="refresh" onPress={() => { pairing.reconnect(); onClose(); }} />
          ) : null}
          <Button label="Pairing & settings" icon="settings" variant="secondary" onPress={() => { onClose(); onOpenSettings(); }} />
          <Button label="Disconnect" icon="power" variant="danger" onPress={() => { pairing.disconnect(); onClose(); }} />
        </View>
      </View>
    </BottomSheet>
  );
}

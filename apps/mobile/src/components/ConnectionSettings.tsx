import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { CameraPermissionState } from '../pairingUi';
import { buildPairingUiState } from '../pairingUi';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { PressableScale, PulseDot } from './primitives/motion';

interface ConnectionSettingsProps {
  readonly gatewayUrl: string;
  readonly token: string | null;
  readonly transportReady: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly autoApprove: boolean;
  readonly socketStatus: string;
  readonly qrScanning: boolean;
  readonly qrPermission: CameraPermissionState;
  readonly manualPairingOpen: boolean;
  readonly activeMode?: string | null;
  readonly activeProvider?: string | null;
  readonly onGatewayUrlChange: (value: string) => void;
  readonly onScanQr: () => void;
  readonly onToggleManualPairing: () => void;
  readonly onPair: () => void;
  readonly onDisconnect: () => void;
  readonly onAutoApproveChange: (value: boolean) => void;
}

export function ConnectionSettings(props: ConnectionSettingsProps) {
  const canPair = props.gatewayUrl.trim().length > 0 && !props.loading;
  const socketConnected = props.socketStatus.toLowerCase() === 'connected';
  const pairingUi = buildPairingUiState({
    token: props.token,
    transportReady: props.transportReady,
    scanning: props.qrScanning,
    permission: props.qrPermission,
  });

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={styles.headerIcon}>
              <MobileIcon name="gateway" size={18} strokeWidth={2.3} color={mobileSurface.accentStrong} />
            </View>
            <Text style={styles.cardTitle}>Gateway</Text>
          </View>
          <View style={[styles.statusPill, props.transportReady ? styles.statusOnline : styles.statusWaiting]}>
            <PulseDot
              color={props.transportReady ? '#16a34a' : '#d97706'}
              size={7}
              pulsing={props.transportReady}
            />
            <Text style={[styles.statusText, props.transportReady ? styles.statusTextOnline : styles.statusTextWaiting]}>
              {pairingUi.statusLabel}
            </Text>
          </View>
        </View>

        <PressableScale
          accessibilityLabel={pairingUi.scanButtonLabel}
          accessibilityRole="button"
          disabled={!pairingUi.scanButtonEnabled}
          scaleTo={0.97}
          onPress={props.onScanQr}
          style={[styles.scanButton, !pairingUi.scanButtonEnabled ? styles.scanButtonDisabled : null]}
        >
          <MobileIcon name="camera" color={pairingUi.scanButtonEnabled ? '#ffffff' : mobileInk.faint} size={21} />
          <Text style={[styles.scanButtonText, !pairingUi.scanButtonEnabled ? styles.disabledText : null]}>
            {pairingUi.scanButtonLabel}
          </Text>
        </PressableScale>

        <PressableScale
          accessibilityLabel={pairingUi.manualPairingToggleLabel}
          accessibilityRole="button"
          scaleTo={0.98}
          onPress={props.onToggleManualPairing}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>{pairingUi.manualPairingToggleLabel}</Text>
          <MobileIcon
            name={props.manualPairingOpen ? 'chevronDown' : 'chevronRight'}
            size={16}
            strokeWidth={2.5}
            color={mobileSurface.accentStrong}
          />
        </PressableScale>

        {props.manualPairingOpen || pairingUi.manualPairingVisible ? (
          <View style={styles.manualStack}>
            <Text style={styles.manualHint}>
              Paste the full ws:// or wss:// URL from Moxxy Desktop — it already includes the access token.
            </Text>
            <TextInput
              value={props.gatewayUrl}
              onChangeText={props.onGatewayUrlChange}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              multiline
              placeholder="wss://…?t=…"
              placeholderTextColor={mobileInk.faint}
              style={styles.input}
            />
            <PressableScale
              accessibilityLabel="Pair gateway"
              accessibilityRole="button"
              disabled={!canPair}
              scaleTo={0.97}
              onPress={props.onPair}
              style={[styles.pairButton, !canPair ? styles.pairButtonDisabled : null]}
            >
              <MobileIcon name="gateway" size={18} strokeWidth={2.3} color={canPair ? '#ffffff' : mobileInk.faint} />
              <Text style={[styles.pairButtonText, !canPair ? styles.disabledText : null]}>Pair gateway</Text>
            </PressableScale>
          </View>
        ) : null}

        {props.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{props.error}</Text>
          </View>
        ) : null}

        {props.token ? (
          <PressableScale
            accessibilityLabel="Disconnect"
            accessibilityRole="button"
            scaleTo={0.97}
            onPress={props.onDisconnect}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonText}>Disconnect</Text>
          </PressableScale>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.cardTitleRow}>
          <View style={styles.headerIcon}>
            <MobileIcon name="settings" size={17} strokeWidth={2.3} color={mobileSurface.accentStrong} />
          </View>
          <Text style={styles.cardTitle}>Runtime</Text>
        </View>
        <SettingRow
          label="Socket"
          value={props.socketStatus}
          dotColor={socketConnected ? '#16a34a' : '#d97706'}
          pulsing={socketConnected}
        />
        <SettingRow label="Provider" value={props.activeProvider ?? 'Unknown'} />
        <SettingRow label="Mode" value={props.activeMode ?? 'Unknown'} last />
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchTitle}>Bypass mode</Text>
            <Text style={styles.switchDescription}>Auto-approve tool calls for this workspace.</Text>
          </View>
          <Switch
            value={props.autoApprove}
            onValueChange={props.onAutoApproveChange}
            trackColor={{ false: '#dfe4f0', true: mobileSurface.accentBorder }}
            thumbColor={props.autoApprove ? mobileSurface.accent : '#ffffff'}
          />
        </View>
      </View>
    </View>
  );
}

function SettingRow({
  label,
  value,
  dotColor,
  pulsing,
  last,
}: {
  readonly label: string;
  readonly value: string;
  readonly dotColor?: string;
  readonly pulsing?: boolean;
  readonly last?: boolean;
}) {
  return (
    <View style={[styles.settingRow, last ? styles.settingRowLast : null]}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.settingValueRow}>
        {dotColor ? <PulseDot color={dotColor} size={8} pulsing={Boolean(pulsing)} /> : null}
        <Text numberOfLines={1} style={styles.settingValue}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    ...mobileFlat.card,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '800',
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.card,
    borderColor: '#fecaca',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  dangerButtonText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '800',
  },
  disabledText: {
    color: mobileInk.faint,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  headerIcon: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  input: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    color: mobileInk.strong,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  manualHint: {
    color: mobileInk.soft,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  manualStack: {
    gap: 12,
  },
  pairButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 50,
  },
  pairButtonDisabled: {
    backgroundColor: mobileSurface.field,
  },
  pairButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 56,
  },
  scanButtonDisabled: {
    backgroundColor: mobileSurface.field,
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: mobileInk.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  settingLabel: {
    color: mobileInk.soft,
    fontSize: 13,
    fontWeight: '600',
  },
  settingRow: {
    alignItems: 'center',
    borderBottomColor: mobileSurface.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  settingRowLast: {
    borderBottomWidth: 0,
  },
  settingValue: {
    color: mobileInk.strong,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  settingValueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
    marginLeft: 12,
    maxWidth: '62%',
  },
  stack: {
    gap: 16,
  },
  statusOnline: {
    backgroundColor: '#ecfdf5',
  },
  statusPill: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  statusTextOnline: {
    color: '#16a34a',
  },
  statusTextWaiting: {
    color: '#d97706',
  },
  statusWaiting: {
    backgroundColor: '#fffbeb',
  },
  switchCopy: {
    flex: 1,
    marginRight: 16,
  },
  switchDescription: {
    color: mobileInk.soft,
    fontSize: 12,
    lineHeight: 20,
    marginTop: 2,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  switchTitle: {
    color: mobileInk.strong,
    fontSize: 14,
    fontWeight: '800',
  },
});

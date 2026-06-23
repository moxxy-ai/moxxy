import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { CameraPermissionState } from '../pairingUi';
import { buildPairingUiState } from '../pairingUi';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
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
            <Gradient preset="brand" radius={11} style={styles.headerIcon}>
              <MobileIcon name="gateway" size={18} strokeWidth={2.3} color="#ffffff" />
            </Gradient>
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
          {pairingUi.scanButtonEnabled ? <Gradient preset="cta" radius={14} style={StyleSheet.absoluteFill} /> : null}
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
            color="#db2777"
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
              {canPair ? <Gradient preset="cta" radius={14} style={StyleSheet.absoluteFill} /> : null}
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
          <Gradient preset="accent" radius={11} style={styles.headerIcon}>
            <MobileIcon name="settings" size={17} strokeWidth={2.3} color="#ffffff" />
          </Gradient>
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
            trackColor={{ false: '#dfe4f0', true: '#f9a8d4' }}
            thumbColor={props.autoApprove ? '#db2777' : '#ffffff'}
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
    backgroundColor: mobileGlass.card.fill,
    borderColor: mobileGlass.card.border,
    borderRadius: 22,
    borderTopColor: mobileGlass.card.hairline,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    ...mobileElevation.md,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '900',
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  headerIcon: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#ef4444',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
  },
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  disabledText: {
    color: mobileInk.faint,
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderColor: 'rgba(226,228,240,0.9)',
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
    fontWeight: '600',
    lineHeight: 19,
  },
  manualStack: {
    gap: 12,
  },
  pairButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 50,
    overflow: 'hidden',
  },
  pairButtonDisabled: {
    backgroundColor: '#dfe4f0',
    opacity: 0.76,
  },
  pairButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  scanButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 56,
    overflow: 'hidden',
  },
  scanButtonDisabled: {
    backgroundColor: '#dfe4f0',
    opacity: 0.76,
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.9)',
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
    fontWeight: '800',
  },
  settingLabel: {
    color: mobileInk.soft,
    fontSize: 13,
    fontWeight: '700',
  },
  settingRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(226,228,240,0.8)',
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
    fontWeight: '800',
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
    backgroundColor: '#dcfce7',
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
    fontWeight: '900',
  },
  statusTextOnline: {
    color: '#16a34a',
  },
  statusTextWaiting: {
    color: '#d97706',
  },
  statusWaiting: {
    backgroundColor: '#fef3c7',
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
    fontWeight: '900',
  },
});

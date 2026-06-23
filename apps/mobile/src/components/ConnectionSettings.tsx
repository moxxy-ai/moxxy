import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { CameraPermissionState } from '../pairingUi';
import { buildPairingUiState, maskPairingCode } from '../pairingUi';
import { mobileElevation, mobileGlass, mobileInk } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { PressableScale, PulseDot } from './primitives/motion';

interface ConnectionSettingsProps {
  readonly gatewayUrl: string;
  readonly token: string | null;
  readonly transportReady: boolean;
  readonly code: string;
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
  readonly onRefreshPairing: () => void;
  readonly onPair: () => void;
  readonly onDisconnect: () => void;
  readonly onAutoApproveChange: (value: boolean) => void;
}

export function ConnectionSettings(props: ConnectionSettingsProps) {
  const canPair = props.code.length > 0 && !props.loading;
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
            <TextInput
              value={props.gatewayUrl}
              onChangeText={props.onGatewayUrlChange}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              placeholderTextColor={mobileInk.faint}
              style={styles.input}
            />
            <View style={styles.codeCard}>
              <Text style={styles.codeEyebrow}>Pairing code</Text>
              <Text style={styles.codeText}>{maskPairingCode(props.code)}</Text>
            </View>
            <View style={styles.buttonRow}>
              <PressableScale
                accessibilityLabel="Refresh pairing"
                accessibilityRole="button"
                scaleTo={0.97}
                onPress={props.onRefreshPairing}
                style={styles.rowButton}
              >
                <Text style={styles.rowButtonText}>Refresh pairing</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Pair"
                accessibilityRole="button"
                disabled={!canPair}
                scaleTo={0.97}
                onPress={props.onPair}
                style={[styles.rowButtonPrimary, !canPair ? styles.rowButtonDisabled : null]}
              >
                {canPair ? <Gradient preset="cta" radius={14} style={StyleSheet.absoluteFill} /> : null}
                <Text style={[styles.rowButtonPrimaryText, !canPair ? styles.disabledText : null]}>Pair</Text>
              </PressableScale>
            </View>
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
        <Text style={styles.cardTitle}>Runtime</Text>
        <SettingRow label="Socket" value={props.socketStatus} />
        <SettingRow label="Provider" value={props.activeProvider ?? 'Unknown'} />
        <SettingRow label="Mode" value={props.activeMode ?? 'Unknown'} />
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

function SettingRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.settingValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
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
  codeCard: {
    alignItems: 'center',
    backgroundColor: '#fdf2f8',
    borderColor: 'rgba(249,168,212,0.55)',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  codeEyebrow: {
    color: '#db2777',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  codeText: {
    color: '#db2777',
    fontSize: 34,
    fontWeight: '900',
    marginTop: 4,
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
    minHeight: 44,
    paddingHorizontal: 12,
  },
  manualStack: {
    gap: 12,
  },
  rowButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  rowButtonDisabled: {
    backgroundColor: '#dfe4f0',
    opacity: 0.76,
  },
  rowButtonPrimary: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
  },
  rowButtonPrimaryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  rowButtonText: {
    color: mobileInk.muted,
    fontSize: 13,
    fontWeight: '800',
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
    paddingVertical: 8,
  },
  settingValue: {
    color: mobileInk.strong,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
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

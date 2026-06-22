import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { CameraPermissionState } from '../pairingUi';
import { buildPairingUiState } from '../pairingUi';
import { MobileIcon } from './MobileIcon';

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
          <Text style={styles.cardTitle}>Gateway</Text>
          <View style={[styles.statusPill, props.transportReady ? styles.statusOnline : styles.statusWaiting]}>
            <Text style={[styles.statusText, props.transportReady ? styles.statusTextOnline : styles.statusTextWaiting]}>
              {pairingUi.statusLabel}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityLabel={pairingUi.scanButtonLabel}
          accessibilityRole="button"
          disabled={!pairingUi.scanButtonEnabled}
          onPress={props.onScanQr}
          style={[styles.scanButton, !pairingUi.scanButtonEnabled ? styles.buttonDisabled : null]}
        >
          <MobileIcon name="camera" color={pairingUi.scanButtonEnabled ? '#ffffff' : '#94a3b8'} size={21} />
          <Text style={[styles.scanButtonText, !pairingUi.scanButtonEnabled ? styles.disabledText : null]}>
            {pairingUi.scanButtonLabel}
          </Text>
        </Pressable>

        <Pressable
          accessibilityLabel={pairingUi.manualPairingToggleLabel}
          accessibilityRole="button"
          onPress={props.onToggleManualPairing}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>{pairingUi.manualPairingToggleLabel}</Text>
          <Text style={styles.secondaryButtonIcon}>{props.manualPairingOpen ? '-' : '+'}</Text>
        </Pressable>

        {props.manualPairingOpen || pairingUi.manualPairingVisible ? (
          <View style={styles.manualStack}>
            <TextInput
              value={props.gatewayUrl}
              onChangeText={props.onGatewayUrlChange}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              style={styles.input}
            />
            <View style={styles.codeCard}>
              <Text style={styles.codeEyebrow}>Pairing code</Text>
              <Text style={styles.codeText}>{props.code || '------'}</Text>
            </View>
            <View style={styles.buttonRow}>
              <Pressable
                accessibilityLabel="Refresh pairing"
                accessibilityRole="button"
                onPress={props.onRefreshPairing}
                style={styles.rowButton}
              >
                <Text style={styles.rowButtonText}>Refresh pairing</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Pair"
                accessibilityRole="button"
                disabled={!canPair}
                onPress={props.onPair}
                style={[styles.rowButtonPrimary, !canPair ? styles.buttonDisabled : null]}
              >
                <Text style={styles.rowButtonPrimaryText}>Pair</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {props.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{props.error}</Text>
          </View>
        ) : null}

        {props.token ? (
          <Pressable accessibilityLabel="Disconnect" accessibilityRole="button" onPress={props.onDisconnect} style={styles.dangerButton}>
            <Text style={styles.dangerButtonText}>Disconnect</Text>
          </Pressable>
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
  buttonDisabled: {
    backgroundColor: '#dfe4f0',
    opacity: 0.76,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOffset: { height: 16, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  codeCard: {
    alignItems: 'center',
    backgroundColor: '#fce7f3',
    borderRadius: 20,
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
    borderRadius: 18,
    justifyContent: 'center',
    minHeight: 44,
  },
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  disabledText: {
    color: '#94a3b8',
  },
  errorBox: {
    backgroundColor: '#fee2e2',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 18,
    borderWidth: 1,
    color: '#0f172a',
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  manualStack: {
    gap: 12,
  },
  rowButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  rowButtonPrimary: {
    alignItems: 'center',
    backgroundColor: '#db2777',
    borderRadius: 18,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  rowButtonPrimaryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  rowButtonText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: '#db2777',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 56,
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  secondaryButtonIcon: {
    color: '#db2777',
    fontSize: 18,
    fontWeight: '900',
  },
  secondaryButtonText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '800',
  },
  settingLabel: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '700',
  },
  settingRow: {
    alignItems: 'center',
    borderBottomColor: '#dfe4f0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  settingValue: {
    color: '#0f172a',
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
    borderRadius: 999,
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
    color: '#64748b',
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
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
  },
});

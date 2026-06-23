import { ConnectionSettings } from '@/components/ConnectionSettings';
import { QrScannerSheet } from '@/components/QrScannerSheet';
import { ScreenFrame } from '@/components/ScreenFrame';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useQrScanner } from '@/hooks/useQrScanner';
import { buildPairingUiState } from '@/pairingUi';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';

export default function SettingsScreen() {
  const { autoApprove, pairing, permissions, session, socketStatus } = useGatewayStore();
  const qrScanner = useQrScanner(pairing.pairFromQrPayload);
  const params = useLocalSearchParams<{ scan?: string }>();
  const [manualPairingOpen, setManualPairingOpen] = useState(false);
  const scanParamHandledRef = useRef(false);
  const pairingUi = buildPairingUiState({
    token: pairing.token,
    transportReady: pairing.transportReady,
    scanning: qrScanner.processing,
    permission: qrScanner.permission,
  });
  const pendingActions = permissions.pendingAsks.length + permissions.pendingPermissions.length;

  useEffect(() => {
    if (params.scan !== '1') {
      scanParamHandledRef.current = false;
      return;
    }
    if (scanParamHandledRef.current) return;
    scanParamHandledRef.current = true;
    void qrScanner.openScanner();
  }, [params.scan, qrScanner.openScanner]);

  return (
    <View style={styles.root}>
      <ScreenFrame
        title="Settings"
        subtitle="Gateway and runtime"
        connected={session.connected}
        pendingActions={pendingActions}
      >
        <ConnectionSettings
          gatewayUrl={pairing.gatewayUrl}
          token={pairing.token}
          transportReady={pairing.transportReady}
          loading={pairing.loading}
          error={pairing.error}
          autoApprove={autoApprove.enabled}
          socketStatus={socketStatus}
          qrScanning={qrScanner.processing}
          qrPermission={qrScanner.permission}
          manualPairingOpen={manualPairingOpen}
          activeMode={session.activeMode}
          activeProvider={session.activeProvider}
          onGatewayUrlChange={pairing.setGatewayUrl}
          onScanQr={() => void qrScanner.openScanner()}
          onToggleManualPairing={() => setManualPairingOpen((open) => !open)}
          onPair={pairing.pair}
          onDisconnect={pairing.disconnect}
          onAutoApproveChange={autoApprove.setAutoApprove}
        />
      </ScreenFrame>
      <QrScannerSheet
        open={qrScanner.open}
        processing={qrScanner.processing}
        armed={qrScanner.armed}
        permission={qrScanner.permission}
        ui={pairingUi}
        onRequestPermission={() => void qrScanner.requestPermission()}
        onArmScanner={qrScanner.armScanner}
        onScanned={(raw) => void qrScanner.handlePayload(raw)}
        onCancel={qrScanner.closeScanner}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

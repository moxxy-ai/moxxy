import { CameraView } from 'expo-camera';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import type { CameraPermissionState, PairingUiState } from '../pairingUi';
import { MobileIcon } from './MobileIcon';

interface QrScannerSheetProps {
  readonly open: boolean;
  readonly processing: boolean;
  readonly armed: boolean;
  readonly permission: CameraPermissionState;
  readonly ui: PairingUiState;
  readonly onRequestPermission: () => void;
  readonly onArmScanner: () => void;
  readonly onScanned: (raw: string) => void;
  readonly onCancel: () => void;
}

export function QrScannerSheet({
  open,
  processing,
  armed,
  permission,
  ui,
  onRequestPermission,
  onArmScanner,
  onScanned,
  onCancel,
}: QrScannerSheetProps) {
  if (!open) return null;

  const canScan = permission === 'granted';
  const scanDisabled = armed || processing;

  return (
    <SafeAreaView style={styles.sheet}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{ui.scannerTitle}</Text>
          <Text style={styles.hint}>{ui.scannerHint}</Text>
        </View>

        <View style={styles.cameraCard}>
          {canScan ? (
            <View style={styles.cameraContent}>
              <View style={styles.cameraViewport}>
                <CameraView
                  facing="back"
                  onBarcodeScanned={armed && !processing ? (result) => onScanned(result.data) : undefined}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  style={styles.camera}
                />
                <View pointerEvents="none" style={styles.focusLayer}>
                  <View style={[styles.focusBox, armed ? styles.focusBoxArmed : styles.focusBoxIdle]} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.permissionState}>
              <Text style={styles.permissionTitle}>
                {permission === 'denied' ? 'Camera access is blocked' : 'Camera permission is required'}
              </Text>
              <Text style={styles.permissionCopy}>
                Scan the QR code from your Mac to pair without typing the gateway address.
              </Text>
              {permission !== 'denied' ? (
                <Pressable onPress={onRequestPermission} style={styles.permissionButton}>
                  <Text style={styles.permissionButtonText}>Allow camera</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {canScan ? (
          <View style={styles.scannerActions}>
            <Pressable
              accessibilityLabel="Start QR code scanning"
              accessibilityRole="button"
              disabled={scanDisabled}
              onPress={onArmScanner}
              style={({ pressed }) => [
                styles.cameraAction,
                scanDisabled ? styles.cameraActionWaiting : null,
                pressed && !scanDisabled ? styles.pressed : null,
              ]}
            >
              <MobileIcon name="camera" color={scanDisabled ? '#db2777' : '#ffffff'} size={20} />
              <Text style={[styles.cameraActionText, scanDisabled ? styles.cameraActionTextWaiting : null]}>
                {processing ? 'Pairing...' : armed ? 'Looking for QR...' : 'Scan QR code'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {processing ? (
          <View style={styles.processingBox}>
            <Text style={styles.processingText}>Pairing...</Text>
          </View>
        ) : null}

        <Pressable onPress={onCancel} style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  camera: {
    flex: 1,
  },
  cameraAction: {
    alignItems: 'center',
    backgroundColor: '#db2777',
    borderRadius: 18,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
  },
  cameraActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  cameraActionTextWaiting: {
    color: '#db2777',
  },
  cameraActionWaiting: {
    backgroundColor: '#fce7f3',
  },
  cameraCard: {
    aspectRatio: 1,
    backgroundColor: '#020617',
    borderColor: '#0f172a',
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { height: 16, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
    width: '100%',
  },
  cameraContent: {
    flex: 1,
    minHeight: 0,
  },
  cameraViewport: {
    backgroundColor: '#020617',
    flex: 1,
    width: '100%',
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  cancelText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '900',
  },
  content: {
    alignSelf: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    maxWidth: 440,
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    width: '100%',
  },
  focusBox: {
    borderRadius: 24,
    borderWidth: 2,
    height: 224,
    width: 224,
  },
  focusBoxArmed: {
    borderColor: '#db2777',
  },
  focusBoxIdle: {
    borderColor: 'rgba(255,255,255,0.9)',
  },
  focusLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: 32,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  header: {
    gap: 4,
  },
  hint: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 24,
  },
  permissionButton: {
    alignItems: 'center',
    backgroundColor: '#db2777',
    borderRadius: 18,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 44,
    paddingHorizontal: 20,
  },
  permissionButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  permissionCopy: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  permissionState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  processingBox: {
    backgroundColor: '#fce7f3',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  processingText: {
    color: '#db2777',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.84,
  },
  scannerActions: {
    alignSelf: 'stretch',
  },
  sheet: {
    backgroundColor: '#f3f5fb',
    flex: 1,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    zIndex: 80,
  },
  title: {
    color: '#0f172a',
    fontSize: 30,
    fontWeight: '900',
  },
});

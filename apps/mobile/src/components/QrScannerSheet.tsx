import { CameraView } from 'expo-camera';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CameraPermissionState, PairingUiState } from '../pairingUi';
import { useTheme } from '@/theme/ThemeProvider';
import { MobileIcon } from './MobileIcon';

interface QrScannerSheetProps {
  readonly open: boolean;
  readonly processing: boolean;
  readonly permission: CameraPermissionState;
  readonly ui: PairingUiState;
  readonly onRequestPermission: () => void;
  readonly onScanned: (raw: string) => void;
  readonly onCancel: () => void;
}

export function QrScannerSheet({
  open,
  processing,
  permission,
  ui,
  onRequestPermission,
  onScanned,
  onCancel,
}: QrScannerSheetProps) {
  const { colors } = useTheme();
  if (!open) return null;

  const canScan = permission === 'granted';

  return (
    <SafeAreaView style={[styles.sheet, { backgroundColor: colors.appBg }]}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{ui.scannerTitle}</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>{ui.scannerHint}</Text>
        </View>

        <View style={[styles.cameraCard, { backgroundColor: colors.black, borderColor: colors.cardBorder, shadowColor: colors.shadow }]}>
          {canScan ? (
            <View style={styles.cameraContent}>
              <View style={[styles.cameraViewport, { backgroundColor: colors.black }]}>
                <CameraView
                  facing="back"
                  onBarcodeScanned={processing ? undefined : (result) => onScanned(result.data)}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  style={styles.camera}
                />
                <View pointerEvents="none" style={styles.focusLayer}>
                  <View style={[styles.focusBox, { borderColor: colors.primaryStrong }]} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.permissionState}>
              <Text style={[styles.permissionTitle, { color: colors.text }]}>
                {permission === 'denied' ? 'Camera access is blocked' : 'Camera permission is required'}
              </Text>
              <Text style={[styles.permissionCopy, { color: colors.textMuted }]}>
                Scan the QR code from your Mac to pair without typing the gateway address.
              </Text>
              {permission !== 'denied' ? (
                <Pressable onPress={onRequestPermission} style={[styles.permissionButton, { backgroundColor: colors.primaryStrong }]}>
                  <Text style={[styles.permissionButtonText, { color: colors.white }]}>Allow camera</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {canScan ? (
          <View style={[styles.cameraAction, styles.scannerActions, { backgroundColor: colors.primarySoft }]}>
            <MobileIcon name="camera" color={colors.primaryStrong} size={20} />
            <Text style={[styles.cameraActionText, { color: colors.primaryStrong }]}>
              {processing ? 'Pairing...' : 'Point at the QR code'}
            </Text>
          </View>
        ) : null}

        <Pressable onPress={onCancel} style={[styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.cardBorder }]}>
          <Text style={[styles.cancelText, { color: colors.textMuted }]}>Cancel</Text>
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
    borderRadius: 18,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
  },
  cameraActionText: {
    fontSize: 14,
    fontWeight: '900',
  },
  cameraCard: {
    aspectRatio: 1,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
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
    flex: 1,
    width: '100%',
  },
  cancelButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  cancelText: {
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
    fontSize: 14,
    lineHeight: 24,
  },
  permissionButton: {
    alignItems: 'center',
    borderRadius: 18,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 44,
    paddingHorizontal: 20,
  },
  permissionButtonText: {
    fontSize: 13,
    fontWeight: '900',
  },
  permissionCopy: {
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
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  processingBox: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  processingText: {
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
    flex: 1,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    zIndex: 80,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
  },
});

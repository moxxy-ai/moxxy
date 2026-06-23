import { CameraView } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CameraPermissionState, PairingUiState } from '../pairingUi';
import { mobileInk } from '../styles/tokens';
import { MobileIcon } from './MobileIcon';
import { Gradient } from './primitives/Gradient';
import { Appear, PressableScale, useReduceMotion } from './primitives/motion';

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

const SCAN_WINDOW = 244;

export function QrScannerSheet({
  open,
  processing,
  permission,
  ui,
  onRequestPermission,
  onScanned,
  onCancel,
}: QrScannerSheetProps) {
  if (!open) return null;

  const canScan = permission === 'granted';

  return (
    <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Appear from="up" style={styles.header}>
          <Text style={styles.title}>{ui.scannerTitle}</Text>
          <Text style={styles.hint}>{ui.scannerHint}</Text>
        </Appear>

        <View style={styles.cameraCard}>
          <View style={styles.cameraClip}>
          {canScan ? (
            <View style={styles.cameraContent}>
              <CameraView
                facing="back"
                onBarcodeScanned={processing ? undefined : (result) => onScanned(result.data)}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                style={styles.camera}
              />
              <View pointerEvents="none" style={styles.focusLayer}>
                <ScanFrame processing={processing} />
              </View>
            </View>
          ) : (
            <View style={styles.permissionState}>
              <Gradient preset="brand" radius={18} style={styles.permissionIcon}>
                <MobileIcon name="camera" size={26} strokeWidth={2.3} color="#ffffff" />
              </Gradient>
              <Text style={styles.permissionTitle}>
                {permission === 'denied' ? 'Camera access is blocked' : 'Camera permission is required'}
              </Text>
              <Text style={styles.permissionCopy}>
                Scan the QR code from your Mac to pair without typing the gateway address.
              </Text>
              {permission !== 'denied' ? (
                <PressableScale accessibilityRole="button" accessibilityLabel="Allow camera" onPress={onRequestPermission} scaleTo={0.95} style={styles.permissionButton}>
                  <Gradient preset="cta" radius={16} style={StyleSheet.absoluteFill} />
                  <Text style={styles.permissionButtonText}>Allow camera</Text>
                </PressableScale>
              ) : null}
            </View>
          )}
          </View>
        </View>

        {canScan ? (
          <View style={styles.statusPill}>
            {processing ? <ActivityDot /> : <View style={styles.liveDot} />}
            <Text style={styles.statusText}>
              {processing ? 'Pairing…' : 'Point your camera at the QR code on your Mac'}
            </Text>
          </View>
        ) : null}

        <PressableScale accessibilityRole="button" accessibilityLabel="Cancel scanning" onPress={onCancel} scaleTo={0.96} style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </PressableScale>
      </View>
    </SafeAreaView>
  );
}

function ScanFrame({ processing }: { readonly processing: boolean }) {
  const reduce = useReduceMotion();
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce || processing) {
      sweep.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [processing, reduce, sweep]);

  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [10, SCAN_WINDOW - 14] });

  return (
    <View style={styles.scanWindow}>
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
      {!processing && !reduce ? (
        <Animated.View style={[styles.scanLineWrap, { transform: [{ translateY }] }]}>
          <Gradient
            direction="horizontal"
            stops={[
              { offset: 0, color: 'rgba(236,72,153,0)' },
              { offset: 0.5, color: '#f472b6' },
              { offset: 1, color: 'rgba(236,72,153,0)' },
            ]}
            style={styles.scanLine}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function ActivityDot() {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  return <Animated.View style={[styles.liveDot, { opacity: reduce ? 1 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]} />;
}

const CORNER = 30;
const styles = StyleSheet.create({
  camera: {
    flex: 1,
  },
  cameraCard: {
    aspectRatio: 1,
    backgroundColor: '#020617',
    borderColor: 'rgba(15,23,42,0.6)',
    borderRadius: 28,
    borderWidth: 1,
    shadowColor: '#0f172a',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 34,
    width: '100%',
  },
  // Inner clip so the live camera honours the rounded corners while the card's
  // depth shadow (above) still renders — iOS clips shadows on overflow:hidden views.
  cameraClip: {
    borderRadius: 27,
    flex: 1,
    overflow: 'hidden',
  },
  cameraContent: {
    flex: 1,
    minHeight: 0,
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  cancelText: {
    color: mobileInk.muted,
    fontSize: 15,
    fontWeight: '900',
  },
  content: {
    alignSelf: 'center',
    flex: 1,
    gap: 18,
    justifyContent: 'center',
    maxWidth: 440,
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 24,
    width: '100%',
  },
  corner: {
    borderColor: '#f472b6',
    height: CORNER,
    position: 'absolute',
    width: CORNER,
  },
  cornerBL: {
    borderBottomLeftRadius: 12,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    bottom: 0,
    left: 0,
  },
  cornerBR: {
    borderBottomRightRadius: 12,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    bottom: 0,
    right: 0,
  },
  cornerTL: {
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
    borderTopWidth: 3,
    left: 0,
    top: 0,
  },
  cornerTR: {
    borderRightWidth: 3,
    borderTopRightRadius: 12,
    borderTopWidth: 3,
    right: 0,
    top: 0,
  },
  focusLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  header: {
    gap: 4,
  },
  hint: {
    color: mobileInk.soft,
    fontSize: 14,
    lineHeight: 22,
  },
  liveDot: {
    backgroundColor: '#10b981',
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  permissionButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 48,
    overflow: 'hidden',
    paddingHorizontal: 22,
  },
  permissionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  permissionCopy: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  permissionIcon: {
    alignItems: 'center',
    height: 56,
    justifyContent: 'center',
    marginBottom: 16,
    width: 56,
  },
  permissionState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  permissionTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  scanLine: {
    borderRadius: 999,
    height: 3,
    width: SCAN_WINDOW - 28,
  },
  scanLineWrap: {
    left: 14,
    position: 'absolute',
    right: 14,
    top: 0,
  },
  scanWindow: {
    height: SCAN_WINDOW,
    width: SCAN_WINDOW,
  },
  sheet: {
    backgroundColor: '#f1f2f9',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 80,
  },
  statusPill: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 999,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    maxWidth: '100%',
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  statusText: {
    color: mobileInk.muted,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: mobileInk.strong,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
});

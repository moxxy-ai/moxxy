import { CameraView } from 'expo-camera';
import { Pressable, Text, View } from 'react-native';
import type { CameraPermissionState, PairingUiState } from '../pairingUi';
import { MobileIcon } from './MobileIcon';

interface QrScannerSheetProps {
  readonly open: boolean;
  readonly processing: boolean;
  readonly armed: boolean;
  readonly permission: CameraPermissionState;
  readonly ui: PairingUiState;
  readonly onRequestPermission: () => void;
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
  onScanned,
  onCancel,
}: QrScannerSheetProps) {
  if (!open) return null;

  const canScan = permission === 'granted';
  return (
    <View
      className="absolute inset-0 z-[80] bg-appBg px-5"
      style={{ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 80 }}
    >
      <View className="flex-1 justify-center gap-5">
        <View>
          <Text className="text-[30px] font-black text-text">{ui.scannerTitle}</Text>
          <Text className="mt-1 text-[14px] leading-6 text-muted">{ui.scannerHint}</Text>
        </View>

        <View className="overflow-hidden rounded-card border border-cardBorder bg-cardBg shadow-card" style={{ height: 360 }}>
          {canScan ? (
            <View className="flex-1">
              <CameraView
                facing="back"
                onBarcodeScanned={armed && !processing ? (result) => onScanned(result.data) : undefined}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                style={{ flex: 1 }}
              />
              <View className="absolute inset-0 items-center justify-center px-8">
                <View className={`h-56 w-56 rounded-card border-2 ${armed ? 'border-primary' : 'border-white/80'}`} />
              </View>
              <View className="absolute bottom-4 left-4 right-4">
                <View className="min-h-12 flex-row items-center justify-center gap-2 rounded-block bg-primarySoft">
                  <MobileIcon name="camera" color="#db2777" size={20} />
                  <Text className="text-[14px] font-black text-primaryStrong">
                    {processing ? 'Pairing...' : 'Looking for QR...'}
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-center text-[16px] font-bold text-text">
                {permission === 'denied' ? 'Camera access is blocked' : 'Camera permission is required'}
              </Text>
              <Text className="mt-2 text-center text-[13px] leading-5 text-muted">
                Scan the QR code from your Mac to pair without typing the gateway address.
              </Text>
              {permission !== 'denied' ? (
                <Pressable
                  className="mt-5 min-h-11 items-center justify-center rounded-block bg-primary px-5"
                  onPress={onRequestPermission}
                >
                  <Text className="text-[13px] font-black text-white">Allow camera</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {processing ? (
          <View className="rounded-card bg-primarySoft px-4 py-3">
            <Text className="text-center text-[13px] font-black text-primaryStrong">Pairing...</Text>
          </View>
        ) : null}

        <Pressable
          className="min-h-12 items-center justify-center rounded-block border border-cardBorder bg-cardBg"
          onPress={onCancel}
        >
          <Text className="text-[14px] font-black text-muted">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

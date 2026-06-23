import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import type { CameraPermissionState } from '../pairingUi';
import { describeQrScannerError } from '../qrScannerFeedback';
import { createQrScanGate } from '../qrScanGate';

export interface QrScannerState {
  readonly open: boolean;
  readonly processing: boolean;
  readonly armed: boolean;
  readonly permission: CameraPermissionState;
  readonly openScanner: () => Promise<void>;
  readonly armScanner: () => void;
  readonly closeScanner: () => void;
  readonly requestPermission: () => Promise<void>;
  readonly handlePayload: (raw: string) => Promise<void>;
}

export function useQrScanner(onPayload: (raw: string) => Promise<void>): QrScannerState {
  const [permission, requestCameraPermission] = useCameraPermissions();
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [armed, setArmed] = useState(false);
  const scanGateRef = useRef(createQrScanGate());

  const permissionState = cameraPermissionState(permission);

  const requestPermission = useCallback(async () => {
    await requestCameraPermission();
  }, [requestCameraPermission]);

  const openScanner = useCallback(async () => {
    // Arm immediately so the camera captures the first QR it sees — no extra tap.
    scanGateRef.current.reset();
    scanGateRef.current.arm();
    setOpen(true);
    setProcessing(false);
    setArmed(true);
    if (!permission?.granted && permission?.canAskAgain !== false) {
      await requestCameraPermission();
    }
  }, [permission?.canAskAgain, permission?.granted, requestCameraPermission]);

  const armScanner = useCallback(() => {
    scanGateRef.current.arm();
    setArmed(true);
  }, []);

  const closeScanner = useCallback(() => {
    scanGateRef.current.reset();
    setOpen(false);
    setProcessing(false);
    setArmed(false);
  }, []);

  const handlePayload = useCallback(async (raw: string) => {
    if (!scanGateRef.current.tryAcquire()) return;
    setArmed(false);
    setProcessing(true);
    try {
      await onPayload(raw);
      scanGateRef.current.reset();
      setOpen(false);
    } catch (err) {
      // Close on error so we return to the pairing screen (which surfaces the
      // error) instead of re-scanning the same bad QR in a loop.
      const description = describeQrScannerError(err);
      scanGateRef.current.reset();
      setOpen(false);
      Alert.alert(description.title, description.message, [{ text: 'OK' }]);
    } finally {
      setProcessing(false);
    }
  }, [onPayload]);

  return {
    open,
    processing,
    armed,
    permission: permissionState,
    openScanner,
    armScanner,
    closeScanner,
    requestPermission,
    handlePayload,
  };
}

function cameraPermissionState(permission: { granted?: boolean; canAskAgain?: boolean } | null): CameraPermissionState {
  if (!permission) return 'loading';
  if (permission.granted) return 'granted';
  return permission.canAskAgain === false ? 'denied' : 'undetermined';
}

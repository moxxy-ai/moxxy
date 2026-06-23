import { useCallback, useEffect, useRef, useState } from 'react';
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
    scanGateRef.current.reset();
    setOpen(true);
    setProcessing(false);
    setArmed(false);
    if (!permission?.granted && permission?.canAskAgain !== false) {
      await requestCameraPermission();
    }
  }, [permission?.canAskAgain, permission?.granted, requestCameraPermission]);

  const armScanner = useCallback(() => {
    scanGateRef.current.arm();
    setArmed(true);
  }, []);

  // Start detecting the instant the scanner is open and the camera is live —
  // opening the scanner *is* the intent to scan, so no extra "start scanning"
  // tap. The one-shot scan gate still guards against double-processing a code,
  // and an unhandled/failed scan re-arms here automatically for a retry.
  useEffect(() => {
    if (open && permissionState === 'granted' && !processing && !armed) {
      scanGateRef.current.arm();
      setArmed(true);
    }
  }, [open, permissionState, processing, armed]);

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
      const description = describeQrScannerError(err);
      scanGateRef.current.reset();
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

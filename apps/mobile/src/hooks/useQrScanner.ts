import { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraPermissions } from 'expo-camera';
import type { CameraPermissionState } from '../pairingUi';
import { createQrScanGate } from '../qrScanGate';

export interface QrScannerState {
  readonly open: boolean;
  readonly processing: boolean;
  readonly armed: boolean;
  readonly permission: CameraPermissionState;
  readonly openScanner: () => Promise<void>;
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
    // Auto-arm: the camera hunts for a QR the moment the sheet opens — the
    // gate's one-shot tryAcquire still dedupes the onBarcodeScanned burst.
    scanGateRef.current.reset();
    scanGateRef.current.arm();
    setOpen(true);
    setProcessing(false);
    setArmed(true);
    if (!permission?.granted && permission?.canAskAgain !== false) {
      await requestCameraPermission();
    }
  }, [permission?.canAskAgain, permission?.granted, requestCameraPermission]);

  // Permission can flip to granted only after the sheet opened (first-run
  // prompt) — arm as soon as the camera becomes usable.
  useEffect(() => {
    if (!open || processing || armed) return;
    if (permissionState !== 'granted') return;
    scanGateRef.current.arm();
    setArmed(true);
  }, [armed, open, permissionState, processing]);

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
      setOpen(false);
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

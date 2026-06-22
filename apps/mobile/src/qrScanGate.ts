export interface QrScanGate {
  readonly arm: () => void;
  readonly tryAcquire: () => boolean;
  readonly reset: () => void;
}

export function createQrScanGate(): QrScanGate {
  let armed = false;
  let acquired = false;

  return {
    arm() {
      armed = true;
      acquired = false;
    },
    tryAcquire() {
      if (!armed) return false;
      if (acquired) return false;
      acquired = true;
      armed = false;
      return true;
    },
    reset() {
      armed = false;
      acquired = false;
    },
  };
}

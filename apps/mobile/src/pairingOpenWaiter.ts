import type { WsClientStatus } from '@moxxy/client-transport-ws';
import { GATEWAY_CONNECTION_FAILED_MESSAGE } from './qrScannerFeedback';

export const DEFAULT_PAIRING_OPEN_TIMEOUT_MS = 2_500;

export interface PairingOpenWaiter {
  readonly wait: Promise<void>;
  readonly onStatus: (status: WsClientStatus) => void;
  readonly cancel: () => void;
}

export function createPairingOpenWaiter(
  timeoutMs = DEFAULT_PAIRING_OPEN_TIMEOUT_MS,
): PairingOpenWaiter {
  let settled = false;
  let resolveWait: (() => void) | null = null;
  let rejectWait: ((err: Error) => void) | null = null;
  const timer = setTimeout(() => {
    reject(new Error(GATEWAY_CONNECTION_FAILED_MESSAGE));
  }, Math.max(1, timeoutMs));

  const wait = new Promise<void>((resolve, rejectPromise) => {
    resolveWait = resolve;
    rejectWait = rejectPromise;
  });

  function resolve(): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveWait?.();
  }

  function reject(err: Error): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectWait?.(err);
  }

  return {
    wait,
    onStatus: (status) => {
      if (status === 'open') {
        resolve();
      } else if (status === 'closed' || status === 'disconnected') {
        reject(new Error(GATEWAY_CONNECTION_FAILED_MESSAGE));
      }
    },
    cancel: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
    },
  };
}

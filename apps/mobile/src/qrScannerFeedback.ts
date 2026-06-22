export const INVALID_MOXXY_QR_TITLE = 'Invalid Moxxy QR code';
export const INVALID_MOXXY_QR_MESSAGE = 'Scan the QR code shown in Moxxy Desktop under Settings -> Mobile.';
export const GATEWAY_CONNECTION_FAILED_TITLE = 'Could not connect to this gateway';
export const GATEWAY_CONNECTION_FAILED_MESSAGE =
  'Could not connect to this gateway. Make sure Moxxy Desktop is running, Mobile Gateway is enabled, and both devices are on the same network.';

export interface QrScannerErrorDescription {
  readonly message: string;
  readonly title: string;
}

export function describeQrScannerError(error: unknown): QrScannerErrorDescription {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/invalid moxxy pairing qr code/i.test(message)) {
    return {
      message: INVALID_MOXXY_QR_MESSAGE,
      title: INVALID_MOXXY_QR_TITLE,
    };
  }

  return {
    message: GATEWAY_CONNECTION_FAILED_MESSAGE,
    title: GATEWAY_CONNECTION_FAILED_TITLE,
  };
}

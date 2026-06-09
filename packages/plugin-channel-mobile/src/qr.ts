/**
 * Render the connect URL as a scannable QR in the terminal, plus the plain URL +
 * token underneath (for manual entry). The mobile app's scanner reads the QR and
 * connects with zero typing.
 */

import QRCode from 'qrcode';

export async function printConnectInfo(url: string, token: string, hint?: string): Promise<void> {
  let qr = '';
  try {
    qr = await QRCode.toString(url, { type: 'terminal', small: true });
  } catch {
    qr = '';
  }
  const lines = [
    '',
    '  📱 Scan to connect the moxxy mobile app:',
    '',
    qr,
    `  url:   ${url}`,
    `  token: ${token}`,
    ...(hint ? ['', `  ℹ ${hint}`] : []),
    '',
    '  (rotate the pairing token — invalidating this QR and every paired app —',
    '   by deleting ~/.moxxy/mobile-token and restarting the channel)',
    '',
  ];
  // CLI surface — intentional stdout.
  console.log(lines.join('\n'));
}

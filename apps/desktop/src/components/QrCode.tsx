/**
 * Render a string (a connect URL / link) as a scannable QR (SVG).
 *
 * Pure-JS via the `qrcode` package's `toString` — no canvas, builds cleanly in
 * the renderer. The SVG is wrapped in an <img> data URL rather than injected via
 * dangerouslySetInnerHTML: an <img>-referenced SVG runs in the browser's
 * restricted mode (no scripts, no external fetches), so even a compromised
 * `qrcode` package cannot inject executable markup into the privileged renderer
 * DOM.
 *
 * Shared by the Mobile gateway pairing UI (settings/MobileTab) and the Channels
 * panel's per-channel connect step (apps/ChannelsPanel).
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrCode({
  value,
  size = 220,
  alt = 'QR code',
  testId,
}: {
  readonly value: string;
  /** Outer box (and QR module) size in px. The image is inset by the 10px quiet-zone padding. */
  readonly size?: number;
  readonly alt?: string;
  readonly testId?: string;
}): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    QRCode.toString(value, { type: 'svg', margin: 1, width: size })
      .then((markup) => {
        if (alive) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(markup)}`);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (failed) {
    return (
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-red)' }}>
        Could not render the QR code. Use the link below instead.
      </p>
    );
  }
  const inner = Math.max(0, size - 20);
  return (
    <div
      data-testid={testId}
      style={{
        width: size,
        height: size,
        // Deliberate literal: QR codes need a white quiet zone for scanner
        // contrast in BOTH themes — never theme this surface.
        background: '#fff',
        borderRadius: 14,
        padding: 10,
        border: '1px solid var(--color-card-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {src && <img src={src} alt={alt} width={inner} height={inner} style={{ display: 'block' }} />}
    </div>
  );
}

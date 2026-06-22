/**
 * Mobile tab — enable the mobile gateway and pair a phone.
 *
 * Turning the gateway on starts the desktop's WebSocket bridge (bound on the
 * LAN-advertised interface) and renders a QR whose payload IS the connect URL
 * (`ws://host:port/?t=<token>`). The shipped mobile app's `parsePairingQrPayload`
 * accepts that string verbatim, so a single scan pairs the phone, which then
 * drives this host exactly like the TUI does.
 *
 * SECURITY — enabling this exposes the host on the local network to anyone who
 * has the QR / token (the bridge binds the LAN). The warning below is shown
 * prominently whenever the gateway is on; "Regenerate code" rotates the token,
 * invalidating the old QR and kicking every connected device.
 */

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useMobileGateway } from '@moxxy/client-core';
import { Button, Icon } from '@moxxy/desktop-ui';
import { Section, Switch } from './settings-primitives';

/** Render a connect URL as a scannable QR (SVG). Pure-JS via the `qrcode`
 *  package's `toString` — no canvas, builds cleanly in the renderer. The SVG
 *  is wrapped in an <img> data URL rather than injected via
 *  dangerouslySetInnerHTML: an <img>-referenced SVG runs in the browser's
 *  restricted mode (no scripts, no external fetches), so even a compromised
 *  `qrcode` package cannot inject executable markup into the privileged
 *  renderer DOM. */
function QrCode({ value }: { readonly value: string }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    QRCode.toString(value, { type: 'svg', margin: 1, width: 220 })
      .then((markup) => {
        if (alive) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(markup)}`);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [value]);

  if (failed) {
    return (
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-red)' }}>
        Could not render the QR code. Use the connect URL below instead.
      </p>
    );
  }
  return (
    <div
      data-testid="mobile-qr"
      style={{
        width: 220,
        height: 220,
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
      {src && (
        <img
          src={src}
          alt="Pairing QR code"
          width={200}
          height={200}
          style={{ display: 'block' }}
        />
      )}
    </div>
  );
}

export function MobileTab(): JSX.Element {
  const { status, loading, busy, error, setEnabled, rotateToken } = useMobileGateway();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // Reset timers cleared on unmount so a closed panel can't setState after
  // teardown (and the timers are released).
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  const failedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(
    () => () => {
      clearTimeout(copiedTimer.current);
      clearTimeout(failedTimer.current);
    },
    [],
  );

  const copyUrl = (): void => {
    if (!status.connectUrl) return;
    setCopyFailed(false);
    const ok = (): void => {
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    };
    const fail = (): void => {
      setCopyFailed(true);
      clearTimeout(failedTimer.current);
      failedTimer.current = setTimeout(() => setCopyFailed(false), 4000);
    };
    // The Clipboard API can reject in a packaged renderer (permission / focus /
    // insecure-context). Surface the failure instead of swallowing it, so the
    // user knows to select the URL manually rather than paste a stale value.
    try {
      const p = navigator.clipboard?.writeText(status.connectUrl);
      if (p && typeof p.then === 'function') p.then(ok, fail);
      else ok();
    } catch {
      fail();
    }
  };

  // Which pairing path is live drives the copy + the security warning. A remote
  // `wss://` connectUrl means the E2E proxy relay is up (off-LAN, encrypted, the
  // relay sees only ciphertext); a `ws://` URL is the LAN fallback (plaintext,
  // same-network only) shown when the relay was unreachable.
  const remote = !!status.connectUrl && status.connectUrl.startsWith('wss://');

  return (
    <Section
      title="Mobile gateway"
      description="Pair the moxxy mobile app to drive this desktop from your phone. Scan the QR in the app — it connects securely over the internet through the moxxy relay, or falls back to your local network if the relay is unreachable."
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: '16px 18px',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 14,
        }}
      >
        {/* Enable toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            aria-hidden
            style={{
              width: 38,
              height: 38,
              flexShrink: 0,
              borderRadius: 11,
              background: 'var(--color-primary-soft)',
              color: 'var(--color-primary-strong)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="lock" size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
              Enable mobile gateway
            </div>
            {/* Announce status transitions (starting/listening/off) to screen
                readers — the LAN bridge can take a moment to start. */}
            <div
              role="status"
              aria-live="polite"
              style={{ marginTop: 2, fontSize: 12, color: 'var(--color-text-dim)' }}
            >
              {loading
                ? 'Checking…'
                : busy
                  ? status.enabled
                    ? 'Stopping…'
                    : 'Starting…'
                  : status.enabled
                    ? `Listening on ${status.host}:${status.port}`
                    : 'Off — your phone cannot connect.'}
            </div>
          </div>
          <Switch
            on={status.enabled}
            label={`${status.enabled ? 'Disable' : 'Enable'} mobile gateway`}
            disabled={busy}
            busy={busy}
            onClick={() => {
              if (!busy) void setEnabled(!status.enabled);
            }}
          />
        </div>

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--color-red)', lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        {/* Security warning — only meaningful (and shown) when the gateway is on.
            Two flavours: the unencrypted-LAN fallback (load-bearing — passive
            interception is possible) and the E2E-encrypted relay path (milder —
            no interception, but the QR/token still grants full control). */}
        {status.enabled && remote && (
          <div
            role="note"
            data-testid="mobile-proxy-note"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              padding: '10px 14px',
              border: '1px solid color-mix(in oklab, var(--color-amber, #d97706) 30%, transparent)',
              background: 'color-mix(in oklab, var(--color-amber, #d97706) 8%, transparent)',
              borderRadius: 12,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'var(--color-text)',
            }}
          >
            <Icon name="lock" size={15} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>
              <strong>Reachable from anywhere over an end-to-end-encrypted link.</strong> The
              connection runs through the moxxy relay, which only ever sees ciphertext — your phone
              and this desktop verify each other directly (the QR pins this machine&apos;s key), so
              the relay cannot read your traffic or impersonate the desktop. But anyone who obtains
              the QR / pairing token can still drive moxxy on this machine: send prompts, run tools,
              read your workspaces. Keep the code private, turn the gateway off when you are done, and
              use <em>Regenerate code</em> if it may have leaked.
            </span>
          </div>
        )}
        {status.enabled && !remote && (
          <div
            role="alert"
            data-testid="mobile-lan-warning"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              padding: '10px 14px',
              border: '1px solid color-mix(in oklab, var(--color-red) 30%, transparent)',
              background: 'color-mix(in oklab, var(--color-red) 8%, transparent)',
              borderRadius: 12,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'var(--color-red)',
            }}
          >
            <Icon name="lock" size={15} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>
              <strong>The relay is unreachable, so this exposes your desktop on the local network
              over an unencrypted connection.</strong> Traffic uses plain <code>ws://</code> (no
              TLS), so anyone on the same network can passively intercept the pairing token and
              everything you send and receive — they do not even need the QR code to do it. Once they
              have the token they can drive moxxy on this machine: send prompts, run tools, read your
              workspaces. Only enable this on networks you trust, turn the gateway off when you are
              done, and use <em>Regenerate code</em> if a token may have leaked.
            </span>
          </div>
        )}

        {/* Pairing surface */}
        {status.enabled && status.connectUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <QrCode value={status.connectUrl} />

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                Connect URL
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code
                  data-testid="mobile-connect-url"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    padding: '8px 10px',
                    // Deliberate literals: terminal-style chip is dark in both
                    // themes (same as the AboutTab update log).
                    background: '#0f172a',
                    color: '#e2e8f0',
                    borderRadius: 8,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={status.connectUrl}
                >
                  {status.connectUrl}
                </code>
                <Button variant="chip" onClick={copyUrl} aria-label="Copy connect URL">
                  <Icon name={copied ? 'check' : 'copy'} size={14} />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {copyFailed && (
                <span
                  role="status"
                  data-testid="mobile-copy-failed"
                  style={{ fontSize: 11.5, color: 'var(--color-red)' }}
                >
                  Copy failed — select the URL above and copy it manually.
                </span>
              )}
            </div>

            <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12 }}>
              {typeof status.clientCount === 'number' && (
                <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {status.clientCount === 1
                    ? '1 device connected'
                    : `${status.clientCount} devices connected`}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <Button
                variant="secondary"
                data-testid="mobile-regenerate"
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => {
                  if (!busy) void rotateToken();
                }}
              >
                <Icon name="rotate" size={14} />
                Regenerate code
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

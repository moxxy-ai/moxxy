import { useState } from 'react';
import { useAppInstall } from '@moxxy/client-core';
import { Button, Icon } from '@moxxy/desktop-ui';
import type { DesktopAppDef } from './registry';
import { OfflineBadge } from './OfflineBadge';

function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(0)} MB`;
}

/** One gallery tile. Apps that `requiresInstall` show the install lifecycle
 *  (Install → progress → Open); others open directly. */
export function AppCard({
  def,
  onOpen,
}: {
  readonly def: DesktopAppDef;
  readonly onOpen: () => void;
}): JSX.Element {
  const { status, progress, installing, install, uninstall } = useAppInstall(def.id);
  const needsInstall = def.requiresInstall === true;
  const state = needsInstall ? (status?.state ?? null) : 'installed';
  // Local re-entrancy guards: the hook has none, and Retry/Uninstall don't enter
  // a busy render branch, so a fast double-click could fire two concurrent IPC
  // invocations. Disable the button while its action is in flight.
  const [busy, setBusy] = useState<'install' | 'uninstall' | null>(null);
  const runInstall = async (): Promise<void> => {
    if (busy || installing) return;
    setBusy('install');
    try {
      await install();
    } finally {
      setBusy(null);
    }
  };
  const runUninstall = async (): Promise<void> => {
    if (busy) return;
    setBusy('uninstall');
    try {
      await uninstall();
    } finally {
      setBusy(null);
    }
  };

  // A concise, screen-reader-only announcement of the install lifecycle so a
  // non-sighted user hears the install start / finish / fail — the visual bar
  // and button swap convey none of this to them.
  const announcement =
    state === 'installing' || installing
      ? `Installing ${def.name}`
      : state === 'error'
        ? `${def.name} failed to install. ${status?.error ?? ''}`.trim()
        : state === 'installed' && needsInstall
          ? `${def.name} installed`
          : '';

  return (
    <li
      data-testid={`app-card-${def.id}`}
      style={{
        // `position: relative` scopes the visually-hidden live region below: an
        // absolutely-positioned child with no positioned ancestor anchors to an
        // arbitrary outer container and can affect page scroll width.
        position: 'relative',
        listStyle: 'none',
        padding: '1rem 1.1rem',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        minHeight: 168,
      }}
    >
      <span
        role="status"
        aria-live="polite"
        data-testid={`app-status-${def.id}`}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announcement}
      </span>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: 10,
            color: 'var(--color-primary)',
            background: 'color-mix(in oklab, var(--color-primary) 12%, transparent)',
          }}
        >
          <Icon name={def.icon} size={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{def.name}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: 3 }}>
            {def.description}
          </div>
        </div>
      </div>

      {def.offline && (
        <div>
          <OfflineBadge />
        </div>
      )}

      <div style={{ flex: 1 }} />

      {state === 'installed' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button variant="primary" data-testid={`open-${def.id}`} onClick={onOpen}>
            Open
          </Button>
          {needsInstall && (
            <button
              type="button"
              onClick={() => void runUninstall()}
              disabled={busy !== null}
              style={{
                fontSize: 12,
                color: 'var(--color-text-dim)',
                background: 'none',
                border: 'none',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy === 'uninstall' ? 'Uninstalling…' : 'Uninstall'}
            </button>
          )}
        </div>
      ) : state === 'installing' || installing ? (
        (() => {
          const known = !!progress && progress.totalBytes > 0;
          const pct = known
            ? Math.round(Math.min(100, (progress!.receivedBytes / progress!.totalBytes) * 100))
            : null;
          const label = known
            ? `Downloading ${mb(progress!.receivedBytes)} of ${mb(progress!.totalBytes)}`
            : 'Downloading…';
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }} aria-hidden>
                {known
                  ? `Downloading… ${mb(progress!.receivedBytes)} / ${mb(progress!.totalBytes)}`
                  : 'Downloading…'}
              </div>
              <div
                role="progressbar"
                aria-label={`Installing ${def.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                {...(pct != null ? { 'aria-valuenow': pct } : {})}
                aria-valuetext={label}
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--color-border)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: pct != null ? `${pct}%` : '40%',
                    background: 'var(--color-primary)',
                    transition: 'width 200ms',
                  }}
                />
              </div>
            </div>
          );
        })()
      ) : state === 'error' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div role="alert" style={{ fontSize: 12, color: 'var(--color-pink)' }}>
            {status?.error ?? 'Install failed.'}
          </div>
          <Button variant="secondary" onClick={() => void runInstall()} disabled={busy !== null}>
            Retry install
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {def.installSummary && (
            <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>{def.installSummary}</div>
          )}
          <div>
            <Button
              variant="primary"
              data-testid={`install-${def.id}`}
              onClick={() => void runInstall()}
              disabled={busy !== null}
            >
              Install
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

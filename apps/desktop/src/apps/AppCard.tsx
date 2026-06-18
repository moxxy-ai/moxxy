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

  return (
    <li
      data-testid={`app-card-${def.id}`}
      style={{
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
              onClick={() => void uninstall()}
              style={{
                fontSize: 12,
                color: 'var(--color-text-dim)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Uninstall
            </button>
          )}
        </div>
      ) : state === 'installing' || installing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>
            {progress && progress.totalBytes > 0
              ? `Downloading… ${mb(progress.receivedBytes)} / ${mb(progress.totalBytes)}`
              : 'Downloading…'}
          </div>
          <div
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
                width:
                  progress && progress.totalBytes > 0
                    ? `${Math.min(100, (progress.receivedBytes / progress.totalBytes) * 100)}%`
                    : '40%',
                background: 'var(--color-primary)',
                transition: 'width 200ms',
              }}
            />
          </div>
        </div>
      ) : state === 'error' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--color-pink)' }}>
            {status?.error ?? 'Install failed.'}
          </div>
          <Button variant="secondary" onClick={() => void install()}>
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
              onClick={() => void install()}
            >
              Install
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

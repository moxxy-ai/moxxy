/**
 * About → "Dashboard" section: shows the app bundle (renderer + main + IPC) the
 * desktop is currently running and lets the user pull a newer one WITHOUT
 * reinstalling. A hot-update — the bundled binary is never exchanged; only the
 * JS bundle under userData is swapped, taking effect on the next launch.
 *
 * The download/verify/install runs main-side (signature-checked); this is the
 * front end of {@link useAppUpdate}.
 */

import { api } from '@/lib/api';
import { useAppUpdate, type UpdateState } from '@/lib/useAppUpdate';
import { Section } from './settings-primitives';

function statusLine(state: UpdateState, latest: string | null): string | null {
  switch (state) {
    case 'checking':
      return 'Checking for updates…';
    case 'uptodate':
      return 'You’re on the latest dashboard.';
    case 'available':
      return `Version ${latest} is available.`;
    case 'incompatible':
      return 'A newer version needs a full app update (reinstall).';
    case 'unavailable':
      return null; // shown via the check.error / muted note instead
    case 'updating':
      return 'Installing…';
    case 'staged':
      return 'Installed. Relaunch to apply.';
    case 'error':
      return null;
    default:
      return null;
  }
}

export function DashboardUpdateSection(): JSX.Element {
  const { info, check, state, progress, error, stagedVersion, runCheck, runUpdate, relaunch } =
    useAppUpdate();

  const configured = info?.channelConfigured ?? false;
  const pct =
    progress?.total && progress.received != null
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;
  const status = statusLine(state, check?.latestVersion ?? null);

  return (
    <Section
      title="Dashboard"
      description="The desktop UI + app code update on their own — no reinstall. A new version downloads in the background and applies on the next launch."
    >
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Version
          </span>
          <span
            className="mono"
            style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)' }}
          >
            {info ? info.version : '…'}
          </span>
          {info && (
            <span style={badge(info.source === 'updated')}>
              {info.source === 'updated' ? 'updated' : 'bundled'}
            </span>
          )}
        </div>

        {!configured && info && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
            Automatic updates aren’t configured for this build. New versions are installed by
            downloading the app.
          </p>
        )}

        {status && (
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              fontWeight: 600,
              color: state === 'staged' || state === 'available' ? 'var(--color-green)' : 'var(--color-text-muted)',
            }}
          >
            {status}
          </p>
        )}

        {state === 'updating' && (
          <div style={{ height: 6, borderRadius: 999, background: 'var(--color-card-border)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: pct != null ? `${pct}%` : '40%',
                background: 'var(--color-primary)',
                transition: 'width 160ms',
              }}
            />
          </div>
        )}

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--color-red)', lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {state === 'staged' ? (
            <button type="button" data-testid="relaunch-app" style={primaryBtn(false)} onClick={relaunch}>
              Relaunch now
            </button>
          ) : state === 'available' ? (
            <button
              type="button"
              data-testid="update-dashboard"
              style={primaryBtn(false)}
              onClick={() => void runUpdate()}
            >
              Update dashboard
            </button>
          ) : state === 'incompatible' && check?.releaseUrl ? (
            <button
              type="button"
              style={primaryBtn(false)}
              onClick={() => void api().invoke('onboarding.openExternal', { url: check.releaseUrl! })}
            >
              Get the update
            </button>
          ) : (
            <button
              type="button"
              data-testid="check-update"
              style={primaryBtn(state === 'checking' || state === 'updating' || !configured)}
              disabled={state === 'checking' || state === 'updating' || !configured}
              onClick={() => void runCheck()}
            >
              {state === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>

        {stagedVersion && state === 'staged' && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-text-dim)' }}>
            v{stagedVersion} will load on the next start.
          </p>
        )}
      </div>
    </Section>
  );
}

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '16px 18px',
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 14,
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  alignSelf: 'flex-start',
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 10,
  color: '#fff',
  border: 'none',
  background: disabled ? 'var(--color-card-border-strong)' : 'var(--color-primary)',
  cursor: disabled ? 'default' : 'pointer',
  transition: 'background 140ms',
});

const badge = (updated: boolean): React.CSSProperties => ({
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '2px 7px',
  borderRadius: 999,
  color: updated ? 'var(--color-green)' : 'var(--color-text-dim)',
  background: updated ? 'rgba(34,197,94,0.12)' : 'var(--color-card-border)',
});

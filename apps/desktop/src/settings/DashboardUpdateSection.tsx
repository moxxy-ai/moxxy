/**
 * About → "Dashboard" section: shows the app bundle (renderer + main + IPC) the
 * desktop is currently running and lets the user pull a newer one WITHOUT
 * reinstalling. A hot-update — the bundled binary is never exchanged; only the
 * JS bundle under userData is swapped, taking effect on the next launch.
 *
 * The download/verify/install runs main-side (signature-checked); this is the
 * front end of {@link useAppUpdate}.
 */

import { api } from '@moxxy/client-core';
import { useAppUpdate, type UpdateState } from '@moxxy/client-core';
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
      return 'A newer version needs a full app update.';
    case 'requires-full-update':
      return `Version ${latest ?? '?'} updates the bundled runner — it can’t apply as a hot-update, but the app can install the full update itself.`;
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

/** Human-readable explanations for the boot-log's structured reject reasons, so
 *  a refused override is legible right in the Diagnostics panel instead of
 *  needing the resolve.ts source to decode. */
const REASON_HINTS: Record<string, string> = {
  'runner-protocol-skew':
    'staged update needs a newer bundled runner than this install can spawn — install the full app update',
  incompatible: 'staged update needs a newer app shell (Electron/ABI) — install the full app update',
  poisoned: 'this version failed a previous boot and is blocked',
  'bad-signature': 'staged bundle failed signature verification',
  'file-tampered': 'a staged file does not match its signed hash',
};

function describeReason(reason: string | undefined): string {
  if (!reason) return '';
  const hint = REASON_HINTS[reason];
  return `  reason=${reason}${hint ? ` (${hint})` : ''}`;
}

export function DashboardUpdateSection(): JSX.Element {
  const {
    info,
    check,
    state,
    progress,
    error,
    stagedVersion,
    diagnostics,
    runCheck,
    runUpdate,
    runShellUpdate,
    loadDiagnostics,
    relaunch,
  } = useAppUpdate();

  const configured = info?.channelConfigured ?? false;
  const pct =
    progress?.total && progress.received != null
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;
  const status = statusLine(state, check?.latestVersion ?? null);
  // Surface a failed check (404 / offline / bad signature) — previously these
  // were swallowed and shown as "up to date".
  const shownError = error ?? check?.error ?? null;

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

        {shownError && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--color-red)', lineHeight: 1.5 }}>
            {shownError}
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
          ) : state === 'incompatible' || state === 'requires-full-update' ? (
            <>
              <button
                type="button"
                data-testid="update-shell"
                style={primaryBtn(false)}
                onClick={() => void runShellUpdate()}
              >
                Update app
              </button>
              {error && check?.releaseUrl && (
                <button
                  type="button"
                  style={primaryBtn(false)}
                  onClick={() =>
                    void api().invoke('onboarding.openExternal', { url: check.releaseUrl! })
                  }
                >
                  Get it manually
                </button>
              )}
            </>
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

        {/* Troubleshooting: if an update "downloads but the app stays old", the
            boot-log here names the exact reason (the previously-silent revert). */}
        <details
          style={{ marginTop: 2 }}
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open) void loadDiagnostics();
          }}
        >
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--color-text-dim)' }}>
            Diagnostics
          </summary>
          {diagnostics ? (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(() => {
                // Surface the last boot-time rejection prominently: a staged
                // update the bootstrap declined (e.g. runner-protocol-skew)
                // used to be visible only by decoding the raw log below.
                const lastBoot = [...diagnostics.log].reverse().find((e) => e.phase === 'boot');
                const reason =
                  lastBoot?.picked === 'floor' &&
                  lastBoot.reason &&
                  !['disabled', 'no-active'].includes(lastBoot.reason)
                    ? lastBoot.reason
                    : null;
                return reason ? (
                  <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-red)', lineHeight: 1.5 }}>
                    Last launch declined the staged update ({reason}
                    {REASON_HINTS[reason] ? `: ${REASON_HINTS[reason]}` : ''}).
                  </p>
                ) : null;
              })()}
              <div style={{ fontSize: 11.5, color: 'var(--color-text-dim)', lineHeight: 1.6 }}>
                running <b className="mono">{diagnostics.running}</b> · active{' '}
                <span className="mono">{diagnostics.active ?? '—'}</span> · confirmed{' '}
                <span className="mono">{diagnostics.confirmed ?? '—'}</span>
                <br />
                staged <span className="mono">{diagnostics.staged.join(', ') || '—'}</span> · bad{' '}
                <span className="mono">{diagnostics.bad.join(', ') || '—'}</span>
              </div>
              <pre style={logBox}>
                {diagnostics.log.length === 0
                  ? '(no boot-log entries yet)'
                  : diagnostics.log
                      .map(
                        (e) =>
                          `${new Date(e.ts).toISOString()}  ${e.phase.padEnd(11)} ${e.picked ?? ''}` +
                          describeReason(e.reason) +
                          (e.recoveredTo ? `  → ${e.recoveredTo}` : '') +
                          (e.error ? `  error=${e.error}` : ''),
                      )
                      .join('\n')}
              </pre>
              <button
                type="button"
                style={{ ...primaryBtn(false), background: 'var(--color-card-border-strong)' }}
                onClick={() => void navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)).catch(() => undefined)}
              >
                Copy diagnostics
              </button>
            </div>
          ) : (
            <p style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-text-dim)' }}>Loading…</p>
          )}
        </details>
      </div>
    </Section>
  );
}

const logBox: React.CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  maxHeight: 220,
  overflow: 'auto',
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'pre',
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 10,
  color: 'var(--color-text-muted)',
};

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
  background: updated ? 'color-mix(in srgb, var(--color-green) 12%, transparent)' : 'var(--color-card-border)',
});

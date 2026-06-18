/**
 * Settings → "Update" section: the ONE place to bring moxxy up to date.
 *
 * A single "Update" button updates BOTH halves of the desktop at once:
 *   - the RUNNER (the bundled `@moxxy/cli`), which restarts live, and
 *   - the DESKTOP app itself (the renderer + main + IPC JS bundle), which
 *     hot-updates and applies on the next launch — or, when a hot-update can't
 *     deliver, downloads the full installer and restarts into it.
 *
 * Both versions are shown for transparency. The download/verify/install all run
 * main-side (signature-checked); this is the front end of {@link useAppUpdate}
 * and only orchestrates + reflects status via `runUpdateAll`.
 */

import { api } from '@moxxy/client-core';
import { useAppUpdate } from '@moxxy/client-core';
import { Section } from './settings-primitives';

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

export function UpdateSection(): JSX.Element {
  const {
    info,
    check,
    state,
    progress,
    error,
    stagedVersion,
    diagnostics,
    cliInfo,
    cliError,
    runUpdateAll,
    loadDiagnostics,
    relaunch,
  } = useAppUpdate();

  const configured = info?.channelConfigured ?? false;
  const pct =
    progress?.total && progress.received != null
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;
  // Surface a failed check (404 / offline / bad signature) — failures used to be
  // swallowed and shown as "up to date".
  const shownError = error ?? check?.error ?? null;

  // Primary button label: the requires-full-update / shell path is handled
  // INSIDE runUpdateAll, so there's never a separate button for it.
  const updating = state === 'updating';
  const ranOnce = state === 'uptodate' || state === 'error' || state === 'requires-full-update';
  const updateLabel = updating
    ? 'Updating…'
    : state === 'uptodate'
      ? 'Up to date — Update again'
      : ranOnce
        ? 'Update again'
        : 'Update';

  return (
    <Section
      title="Update"
      description="One update for everything — the desktop app and its bundled runner come to the latest version together, no reinstall. A new app version applies on the next launch; the runner restarts live."
    >
      <div style={card}>
        {/* App / dashboard version */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            App version
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

        {/* Runner (CLI) version */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Runner version
          </span>
          <span
            className="mono"
            style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)' }}
          >
            {cliInfo ? (cliInfo.version ?? 'unknown') : '…'}
          </span>
        </div>
        {cliInfo?.path && (
          <div
            className="mono"
            title={cliInfo.path}
            style={{
              fontSize: 11.5,
              marginTop: -6,
              color: 'var(--color-text-dim)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {cliInfo.path}
          </div>
        )}

        {!configured && info && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
            Automatic app updates aren’t configured for this build. New versions are installed by
            downloading the app.
          </p>
        )}

        {state === 'staged' && (
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--color-green)' }}>
            Installed. Relaunch to apply.
          </p>
        )}
        {state === 'uptodate' && (
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            You’re on the latest version.
          </p>
        )}
        {updating && progress?.message && (
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {progress.message}
          </p>
        )}

        {updating && (
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

        {/* The runner update is non-fatal: if it was skipped, the bundled CLI
            keeps working. Surface it as a secondary note. */}
        {cliError && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-red)', lineHeight: 1.5 }}>
            {cliError} The bundled runner keeps working.
            {/npm not found/i.test(cliError) && (
              <> Install Node.js to update the runner from within the app.</>
            )}
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {state === 'staged' ? (
            <button type="button" data-testid="relaunch-app" style={primaryBtn(false)} onClick={relaunch}>
              Relaunch now
            </button>
          ) : (
            <button
              type="button"
              data-testid="update-all"
              style={primaryBtn(updating)}
              disabled={updating}
              onClick={() => void runUpdateAll()}
            >
              {updateLabel}
            </button>
          )}
          {/* The full-installer path is handled inside runUpdateAll. Only when
              that automatic attempt failed (e.g. unsigned build) do we offer the
              release page as a manual fallback. */}
          {state === 'requires-full-update' && error && check?.releaseUrl && (
            <button
              type="button"
              style={primaryBtn(false)}
              onClick={() => void api().invoke('onboarding.openExternal', { url: check.releaseUrl! })}
            >
              Get it manually
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

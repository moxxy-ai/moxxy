import { useState } from 'react';
import type { ConnectionPhase, ConnectionSnapshot } from '@moxxy/desktop-ipc-contract';
import { asset } from '@/lib/asset';
import { Splash } from '@/Splash';

/** Result of an in-app CLI update attempt. On success the caller (App.tsx)
 *  has already kicked the supervisor retry; on failure we surface `error`
 *  and fall back to the manual escape hatch. */
export interface UpdateCliResult {
  readonly ok: boolean;
  readonly error?: string;
}

interface ConnectionScreenProps {
  readonly snapshot: ConnectionSnapshot | null;
  readonly onRetry: () => void;
  /**
   * Updates the bundled CLI in place (host `app.updateCli`) and, on success,
   * triggers the same supervisor retry `onRetry` does. Only invoked from the
   * terminal `protocol-incompatible` screen when the runner is OLDER than the
   * app — the one direction a CLI update can fix. Optional so existing call
   * sites (and the non-terminal phases) keep working unchanged.
   */
  readonly onUpdateCli?: () => Promise<UpdateCliResult>;
}

/**
 * First-connect loading surface. Normal connecting phases (idle /
 * resolving-cli / spawning / adopting / attaching) reuse the branded
 * {@link Splash} — the moxxy animation on the near-white chat background —
 * so cold-start → loading → chat reads as one continuous surface (no more
 * greyish "Starting moxxy serve…" card with socket/pid rows).
 *
 * Only a real problem (failed / cli-missing / reconnecting) swaps in a
 * friendly error card with a Retry and a collapsible "Technical details"
 * readout — so we stay calm without hiding the diagnostics when something
 * is actually wrong.
 */
export function ConnectionScreen({
  snapshot,
  onRetry,
  onUpdateCli,
}: ConnectionScreenProps): JSX.Element {
  const phase: ConnectionPhase = snapshot?.phase ?? { phase: 'idle' };
  const problem =
    phase.phase === 'failed' ||
    phase.phase === 'cli-missing' ||
    phase.phase === 'reconnecting' ||
    phase.phase === 'protocol-incompatible';
  // A protocol incompatibility is TERMINAL — a bare respawn hits the same
  // pinned CLI, so a plain "Try again" would loop straight back into the dead
  // end. Instead of a retry, the terminal screen offers an in-app self-heal
  // (update the CLI, then retry) when the runner is the OLDER side.
  const terminal = phase.phase === 'protocol-incompatible';

  // Happy path: a continuous branded loading screen.
  if (!problem) {
    return <Splash message={friendlyTitle(phase.phase)} />;
  }

  // Something's wrong — same near-white surface, but with a headline,
  // a retry, and the diagnostics tucked behind a disclosure.
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        background: 'var(--color-main-bg)',
        color: 'var(--color-text)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          maxWidth: 480,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <img
          src={asset('new-animation.gif')}
          alt=""
          aria-hidden="true"
          style={{ width: 120, height: 'auto', objectFit: 'contain' }}
        />
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {friendlyTitle(phase.phase)}
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              color: 'var(--color-text-muted)',
              fontSize: 13.5,
              lineHeight: 1.6,
            }}
          >
            {friendlySub(phase)}
          </p>
        </div>

        {phase.phase === 'protocol-incompatible' ? (
          <ProtocolIncompatibleActions
            phase={phase}
            snapshot={snapshot}
            onUpdateCli={onUpdateCli}
          />
        ) : (
          !terminal && (
            <button
              type="button"
              onClick={onRetry}
              style={primaryButtonStyle(false)}
            >
              Try again
            </button>
          )
        )}

        <TechnicalDetails snapshot={snapshot} phase={phase} />
      </div>
    </main>
  );
}

/**
 * Action area for the terminal protocol-incompatible screen.
 *
 * The runner SERVER speaks `serverVersion`; this app's CLIENT speaks
 * `clientVersion`. Two directions:
 *
 *   - server < client (the common case after a desktop hot-update): the
 *     installed CLI is too OLD. Updating the CLI in place fixes it, so we
 *     offer the primary "Update CLI & reconnect" button. On click we run
 *     `onUpdateCli` (host `app.updateCli`), show progress, and on success
 *     the supervisor respawns the now-newer runner.
 *   - client < server (the app is the older side): updating the CLI can't
 *     help — the user needs a newer APP. Show reinstall guidance, no button.
 *
 * When versions are unknown (null) we can't prove the updatable direction,
 * so we still offer the update button (it's the most likely fix) but lean on
 * the manual escape hatch in the details.
 */
function ProtocolIncompatibleActions({
  phase,
  snapshot,
  onUpdateCli,
}: {
  readonly phase: Extract<ConnectionPhase, { phase: 'protocol-incompatible' }>;
  readonly snapshot: ConnectionSnapshot | null;
  readonly onUpdateCli?: () => Promise<UpdateCliResult>;
}): JSX.Element {
  const [status, setStatus] = useState<'idle' | 'updating' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const { serverVersion, clientVersion } = phase;
  // The app is strictly newer than the runner → the CLI is the stale side and
  // an in-place update is the fix. When either version is unknown we treat the
  // update as offerable (it's the common, fixable direction).
  const appNewerThanRunner =
    serverVersion === null || clientVersion === null
      ? true
      : serverVersion < clientVersion;
  const canUpdate = appNewerThanRunner && !!onUpdateCli;

  const runUpdate = async (): Promise<void> => {
    if (!onUpdateCli) return;
    setStatus('updating');
    setError(null);
    const result = await onUpdateCli();
    if (result.ok) {
      // App.tsx has already kicked the supervisor retry; this screen will be
      // torn down as the connection phase advances. Keep the spinner up.
      return;
    }
    setError(result.error ?? 'The update failed. Try the manual command below.');
    setStatus('error');
  };

  const manualCommand = manualUpdateCommand(snapshot?.cliPath ?? null);

  if (!canUpdate) {
    // client < server (or no updater wired): updating the CLI won't help.
    return (
      <div
        role="note"
        style={{
          fontSize: 12.5,
          color: 'var(--color-text-muted)',
          lineHeight: 1.6,
          maxWidth: 420,
        }}
      >
        This app is older than the moxxy runner it found, so updating the CLI
        won&rsquo;t help. Reinstall the latest moxxy desktop app to continue.
      </div>
    );
  }

  const updating = status === 'updating';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        width: '100%',
      }}
    >
      <button
        type="button"
        onClick={() => void runUpdate()}
        disabled={updating}
        aria-busy={updating}
        style={primaryButtonStyle(updating)}
      >
        {updating ? 'Updating the moxxy CLI…' : 'Update CLI & reconnect'}
      </button>

      {status === 'error' && error && (
        <div
          role="alert"
          style={{
            fontSize: 12.5,
            color: 'var(--color-red)',
            lineHeight: 1.6,
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0 }}>{error}</p>
          <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)' }}>
            You can update it by hand instead, or reinstall the app:
          </p>
          <code
            className="mono"
            style={{
              display: 'block',
              margin: '6px 0 0',
              padding: '6px 8px',
              background: 'var(--color-card-bg)',
              border: '1px solid var(--color-card-border)',
              borderRadius: 8,
              fontSize: 11.5,
              color: 'var(--color-text)',
              wordBreak: 'break-all',
              textAlign: 'left',
            }}
          >
            {manualCommand}
          </code>
        </div>
      )}
    </div>
  );
}

/**
 * The exact shell command a user can run to update the CLI by hand if the
 * in-app button fails. Mirrors {@link updateCli}'s real invocation:
 *   npm install --prefix "<userData>/cli" @moxxy/cli@latest
 *
 * `<userData>/cli` is derived from the resolved CLI path the snapshot carries
 * (`<userData>/cli/node_modules/@moxxy/cli/dist/bin.js`) by stripping the
 * trailing `node_modules/@moxxy/cli/dist/bin.js`. Falls back to a generic
 * placeholder when the path is unknown or doesn't match the expected layout.
 */
export function manualUpdateCommand(cliPath: string | null): string {
  const prefix = cliPrefixFromPath(cliPath) ?? '<userData>/cli';
  return `npm install --prefix "${prefix}" @moxxy/cli@latest`;
}

function cliPrefixFromPath(cliPath: string | null): string | null {
  if (!cliPath) return null;
  // Handle both POSIX and Windows separators; the prefix is the dir that
  // CONTAINS node_modules/@moxxy/cli/….
  const marker = /[/\\]node_modules[/\\]@moxxy[/\\]cli[/\\]/;
  const m = marker.exec(cliPath);
  if (!m) return null;
  return cliPath.slice(0, m.index);
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '9px 20px',
    background: disabled ? 'var(--color-card-border-strong)' : 'var(--grad-cta)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 13.5,
    cursor: disabled ? 'default' : 'pointer',
    boxShadow: disabled
      ? 'none'
      : '0 10px 20px -12px color-mix(in srgb, var(--color-primary) 55%, transparent)',
  };
}

/** Friendly, non-technical headline per phase. */
function friendlyTitle(phase: string): string {
  switch (phase) {
    case 'idle':
      return 'Waking moxxy up…';
    case 'resolving-cli':
      return 'Finding moxxy on your machine…';
    case 'spawning':
    case 'adopting':
    case 'attaching':
      return 'Getting your workspace ready…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'cli-missing':
      return "moxxy isn't installed yet";
    case 'protocol-incompatible':
      return 'Update needed to continue';
    case 'failed':
      return "Couldn't connect";
    default:
      return 'Getting things ready…';
  }
}

/** Friendly one-liner for the problem states. */
function friendlySub(phase: ConnectionPhase): string {
  switch (phase.phase) {
    case 'failed':
      return 'moxxy couldn’t reach the runner. Try again, or open the details below.';
    case 'cli-missing':
      return 'The moxxy command needs to be installed first — see the details below.';
    case 'reconnecting':
      return phase.reason
        ? `Lost the connection — ${phase.reason}`
        : 'Lost the connection to the runner. Reconnecting…';
    case 'protocol-incompatible':
      return phase.hint;
    default:
      return 'Hang tight while we get everything ready.';
  }
}

/** Collapsible diagnostics — the old phase/socket/error rows + runner log,
 *  kept for debugging but out of the way by default. */
function TechnicalDetails({
  snapshot,
  phase,
}: {
  readonly snapshot: ConnectionSnapshot | null;
  readonly phase: ConnectionPhase;
}): JSX.Element {
  const hasLog = !!snapshot && snapshot.log.length > 0;
  return (
    <details style={{ width: '100%', textAlign: 'left' }}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: '0.7rem',
          color: 'var(--color-text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Technical details
      </summary>
      <div
        style={{
          marginTop: '0.6rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <DetailRow label="phase" value={phase.phase} />
        {snapshot?.cliPath && <DetailRow label="moxxy" value={snapshot.cliPath} />}
        {'socket' in phase && phase.socket && (
          <DetailRow label="socket" value={phase.socket} />
        )}
        {phase.phase === 'cli-missing' && <DetailRow label="hint" value={phase.hint} />}
        {phase.phase === 'reconnecting' && (
          <>
            <DetailRow label="reason" value={phase.reason} />
            <DetailRow label="attempt" value={String(phase.attempt)} />
          </>
        )}
        {phase.phase === 'failed' && (
          <>
            <DetailRow label="error" value={phase.error} />
            {phase.hint && <DetailRow label="hint" value={phase.hint} />}
          </>
        )}
        {phase.phase === 'protocol-incompatible' && (
          <>
            <DetailRow
              label="runner"
              value={phase.serverVersion === null ? '(unknown)' : `v${phase.serverVersion}`}
            />
            <DetailRow
              label="app"
              value={phase.clientVersion === null ? '(unknown)' : `v${phase.clientVersion}`}
            />
            <DetailRow label="detail" value={phase.detail} />
            <DetailRow label="hint" value={phase.hint} />
            {/* The manual escape hatch — exact command to update the CLI by
                hand if the in-app button fails (or "reinstall the app"). */}
            <DetailRow label="manual" value={manualUpdateCommand(snapshot?.cliPath ?? null)} />
          </>
        )}
        {hasLog && snapshot && (
          <pre
            className="mono"
            style={{
              margin: '0.2rem 0 0',
              padding: '0.5rem 0.6rem',
              background: 'var(--color-card-bg)',
              border: '1px solid var(--color-card-border)',
              borderRadius: 8,
              fontSize: '0.7rem',
              color: 'var(--color-text-muted)',
              maxHeight: 240,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {snapshot.log.map((l) => `[${l.stream}] ${l.line}`).join('\n')}
          </pre>
        )}
      </div>
    </details>
  );
}

function DetailRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 1fr',
        gap: '0.5rem',
        fontSize: '0.75rem',
        alignItems: 'baseline',
      }}
    >
      <span
        className="mono"
        style={{
          color: 'var(--color-text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{ color: 'var(--color-text-muted)', wordBreak: 'break-word' }}
      >
        {value}
      </span>
    </div>
  );
}

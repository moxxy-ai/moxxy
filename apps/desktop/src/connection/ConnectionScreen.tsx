import type { ConnectionPhase, ConnectionSnapshot } from '@moxxy/desktop-ipc-contract';
import { asset } from '@/lib/asset';
import { Splash } from '@/Splash';

interface ConnectionScreenProps {
  readonly snapshot: ConnectionSnapshot | null;
  readonly onRetry: () => void;
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
}: ConnectionScreenProps): JSX.Element {
  const phase: ConnectionPhase = snapshot?.phase ?? { phase: 'idle' };
  const problem =
    phase.phase === 'failed' ||
    phase.phase === 'cli-missing' ||
    phase.phase === 'reconnecting';

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
        background: 'rgb(252, 252, 255)',
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

        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: '9px 20px',
            background: 'var(--grad-cta)',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 13.5,
            cursor: 'pointer',
            boxShadow: '0 10px 20px -12px rgba(236, 72, 153, 0.55)',
          }}
        >
          Try again
        </button>

        <TechnicalDetails snapshot={snapshot} phase={phase} />
      </div>
    </main>
  );
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

/**
 * The moxxy CLI install step — probes the PATH for the CLI on mount,
 * installs it via npm on demand while streaming install progress to a log
 * box, and only enables Continue once the CLI is present. Applies on
 * first run and whenever the recovery gate detects the CLI went missing.
 *
 * State + install lifecycle come from the shared `useOnboarding().install`
 * controller (the same one NodeStep uses for Node) — running/progress/error
 * and a `run()` that installs the CLI and refreshes `status` — so this step
 * never re-implements the probe/subscribe/install dance.
 */

import { useOnboarding } from '@moxxy/client-core';
import { StepCard, Nav, PrimaryButton, SuccessRow, Pulse } from '../chrome';

export function CliStep({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  const ob = useOnboarding();
  const present = ob.status?.cliInstalled ?? false;
  const installing = ob.install.running;
  // The controller carries a thrown-exception message in `error` and a
  // non-zero npm exit in `lastExitCode`. Surface either as the red failure
  // line (mirroring the prior inline `npm exit N` / thrown-message handling).
  const exitCode = ob.install.lastExitCode;
  const error =
    ob.install.error ?? (exitCode !== null && exitCode !== 0 ? `npm exit ${exitCode}` : null);
  const failed = !installing && !present && error !== null;
  const probing = ob.loading && !present && !installing;
  const log = ob.install.progress;

  return (
    <StepCard
      title="Install moxxy"
      sub="The moxxy CLI runs your agent locally. We use npm to install it."
    >
      {probing && <Pulse label="Looking for moxxy on your PATH…" />}
      {present && <SuccessRow text="moxxy is installed and ready." />}
      {!present && !installing && !probing && (
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--color-primary-soft)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {failed ? 'Install failed.' : 'moxxy isn\'t installed yet.'}
          </div>
          {error && <div style={{ color: 'var(--color-red)' }}>{error}</div>}
          <PrimaryButton onClick={() => void ob.install.run()}>
            {failed ? 'Try again' : 'Install moxxy'}
          </PrimaryButton>
        </div>
      )}
      {installing && (
        <>
          <Pulse label="Installing moxxy via npm…" />
          {log.length > 0 && (
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 10,
                background: '#0f172a',
                color: '#e2e8f0',
                borderRadius: 10,
                fontSize: 11,
                maxHeight: 180,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {log.slice(-40).join('\n')}
            </pre>
          )}
        </>
      )}
      <Nav onBack={onBack} onNext={onNext} nextDisabled={!present} />
    </StepCard>
  );
}

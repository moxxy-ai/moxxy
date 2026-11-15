/**
 * The moxxy CLI install step — shown only when the CLI is really missing
 * (the installer normally carries it). It installs it on demand, keeps the
 * streamed log behind "Show details", and only enables Continue once the CLI
 * is present. It speaks to someone who never programmed: no CLI, npm or PATH.
 *
 * State + install lifecycle come from the shared `useOnboarding().install`
 * controller (the same one NodeStep uses for Node) — running/progress/error
 * and a `run()` that installs the CLI and refreshes `status` — so this step
 * never re-implements the probe/subscribe/install dance.
 */

import { useOnboarding } from '@moxxy/client-core';
import { StepCard, Nav, PrimaryButton, SuccessRow, Pulse } from '../chrome';
import { InstallLog } from '../chrome/InstallLog';

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
  // non-zero exit in `lastExitCode`; either is kept as a small detail under
  // the plain failure line, for whoever helps the person later.
  const exitCode = ob.install.lastExitCode;
  const error =
    ob.install.error ?? (exitCode !== null && exitCode !== 0 ? `Exit code ${exitCode}` : null);
  const failed = !installing && !present && error !== null;
  const probing = ob.loading && !present && !installing;
  const log = ob.install.progress;

  return (
    <StepCard
      title="Set up Moxxy"
      sub="Moxxy needs one more part on this computer. It takes about a minute and happens once."
    >
      {probing && <Pulse label="Checking this computer…" />}
      {present && <SuccessRow text="Moxxy is ready." />}
      {!present && !installing && !probing && (
        <div className="onboard-panel">
          {failed && (
            <div role="alert" className="onboard-error">
              The setup did not finish. Check your internet connection and try again.
            </div>
          )}
          {error && <div className="onboard-panel__detail">{error}</div>}
          <PrimaryButton onClick={() => void ob.install.run()}>
            {failed ? 'Try again' : 'Set up Moxxy'}
          </PrimaryButton>
        </div>
      )}
      {installing && (
        <>
          <Pulse label="Setting up Moxxy…" />
          <InstallLog lines={log} />
        </>
      )}
      <Nav onBack={onBack} onNext={onNext} nextDisabled={!present} />
    </StepCard>
  );
}

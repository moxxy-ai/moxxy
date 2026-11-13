/**
 * The runtime step — only applies when the computer has no Node.
 *
 * The install starts by itself ({@link useRuntimeAutoInstall}); this step only
 * shows it happening, in the product's words rather than the runtime's name.
 * A failed download offers a retry, with the manual download as a last resort.
 */

import type { UseOnboarding } from '@moxxy/client-core';
import {
  StepCard,
  Nav,
  PrimaryButton,
  SecondaryButton,
  SuccessRow,
  Pulse,
} from '../chrome';
import { InstallLog } from '../chrome/InstallLog';

export function NodeStep({
  onNext,
  onBack,
  ob,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
  /** The SHARED onboarding instance, lifted in {@link Onboarding} — NodeStep
   *  must not call `useOnboarding()` itself (doubled probes + subscription). */
  readonly ob: UseOnboarding;
}): JSX.Element {
  const installed = ob.node?.installed ?? false;
  const installing = ob.installNode.running;
  const log = ob.installNode.progress;
  const error = ob.installNode.error;

  return (
    <StepCard
      title="Getting Moxxy ready"
      sub="Moxxy is downloading a component it needs to run. This happens once and needs nothing from you."
    >
      {installed ? (
        <SuccessRow text="Everything is in place." />
      ) : installing || !error ? (
        <>
          <Pulse label="Downloading and installing…" />
          <InstallLog lines={log} />
        </>
      ) : (
        <div className="onboard-panel">
          <div role="alert" className="onboard-error">
            The download did not finish. Check your internet connection and try again.
          </div>
          <div className="onboard-panel__detail">{error}</div>
          <PrimaryButton onClick={() => void ob.installNode.run()}>Try again</PrimaryButton>
          <SecondaryButton
            onClick={() => void ob.openExternal('https://nodejs.org/en/download')}
          >
            Install it myself
          </SecondaryButton>
        </div>
      )}
      <Nav
        onBack={onBack}
        onNext={installed ? onNext : () => void ob.refresh()}
        nextLabel={installed ? 'Continue' : 'Re-check'}
        nextDisabled={installing}
      />
    </StepCard>
  );
}

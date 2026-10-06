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
          {log.length > 0 && (
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 10,
                background: '#0b0d12',
                color: '#e2e8f0',
                borderRadius: 'var(--radius-block)',
                fontSize: 'var(--type-meta)',
                maxHeight: 180,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {log.slice(-40).join('\n')}
            </pre>
          )}
        </>
      ) : (
        <div
          style={{
            padding: '16px 18px',
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 'var(--radius-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div role="alert" style={{ fontSize: 'var(--type-row)', color: 'var(--color-red)' }}>
            The download did not finish. Check your internet connection and try again.
          </div>
          <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>{error}</div>
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

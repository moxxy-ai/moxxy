/**
 * The Node.js prerequisite step — only applies when Node isn't detected.
 *
 * Offers a one-click **auto-install** (downloads the official Node LTS into the
 * app's data dir and puts it on PATH — no admin, no package manager) with the
 * manual nodejs.org download as a fallback. Streams install progress to a log
 * box and advances once Node is present.
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
      title="Install Node.js"
      sub="Node.js is the runtime moxxy runs on. I can install it for you — no setup or admin needed — or you can grab it from nodejs.org yourself."
    >
      {installed ? (
        <SuccessRow text={`Node ${ob.node?.version ?? ''} is ready.`} />
      ) : installing ? (
        <>
          <Pulse label="Downloading and installing Node…" />
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
      ) : (
        <div
          style={{
            padding: '16px 18px',
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {error && (
            <div role="alert" style={{ fontSize: 12.5, color: 'var(--color-red)' }}>
              {error}
            </div>
          )}
          <PrimaryButton onClick={() => void ob.installNode.run()}>
            {error ? 'Try again' : 'Install automatically'}
          </PrimaryButton>
          <SecondaryButton
            onClick={() => void ob.openExternal('https://nodejs.org/en/download')}
          >
            Download from nodejs.org
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

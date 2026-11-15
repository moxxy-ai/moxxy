/**
 * The plans a person may already pay for. Each row says in plain words what
 * pressing it does next (install, sign in, or nothing left to do); the sign-in
 * opens right under the list. Presentational: {@link useStartStep} runs it.
 */

import { Button } from '@moxxy/desktop-ui';
import { ChoiceRow, StepCard } from '../../chrome';
import { OAuthSignIn } from '../../../settings/shared/OAuthSignIn';
import type { StartOption, StartProvider } from '../../start-options';

export function PlanView({
  plans,
  busy,
  signingIn,
  error,
  onChoose,
  onSignedIn,
  onBack,
  onFree,
}: {
  readonly plans: ReadonlyArray<StartOption>;
  readonly busy: StartProvider | null;
  readonly signingIn: StartProvider | null;
  readonly error: string | null;
  readonly onChoose: (provider: StartProvider) => void;
  readonly onSignedIn: () => Promise<void>;
  readonly onBack: () => void;
  readonly onFree: () => void;
}): JSX.Element {
  const signing = plans.find((plan) => plan.provider === signingIn) ?? null;
  return (
    <StepCard title="Use your plan" sub="Pick the one you pay for. Moxxy opens your browser so you can sign in once.">
      <div className="onboard-choices">
        {plans.map((plan) => (
          <ChoiceRow
            key={plan.provider}
            title={plan.name}
            detail={plan.detail}
            busy={busy === plan.provider || plan.state === 'installing'}
            disabled={busy !== null && busy !== plan.provider}
            progress={plan.progress}
            onPress={() => onChoose(plan.provider)}
          />
        ))}
      </div>
      {signing && (
        <OAuthSignIn
          key={signing.provider}
          provider={signing.provider}
          name={signing.name}
          startLabel={`Sign in to ${signing.name}`}
          autoStart
          onSignedIn={onSignedIn}
        />
      )}
      {error && (
        <p role="alert" className="onboard-error">
          {error}
        </p>
      )}
      <footer className="onboard-start__foot">
        <Button variant="secondary" size="lg" onClick={onBack}>
          Back
        </Button>
        <Button variant="ghost" size="lg" onClick={onFree}>
          Start free instead
        </Button>
      </footer>
    </StepCard>
  );
}

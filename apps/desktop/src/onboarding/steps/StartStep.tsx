/**
 * The first-run question and its two follow-ups: a plan the person already
 * pays for, a free model, or an API key. Also the recovery gate's step when no
 * provider is active. It wires the hooks to the views; the views only draw.
 */

import { useApiKeyConnect } from '../useApiKeyConnect';
import { useStartStep } from '../useStartStep';
import { ApiKeyView } from './start/ApiKeyView';
import { ChooseView } from './start/ChooseView';
import { PlanView } from './start/PlanView';

export function StartStep({
  onDone,
  onSkip,
  notice,
}: {
  /** The choice is connected and active: enter the app. */
  readonly onDone: () => void;
  readonly onSkip: () => void;
  readonly notice?: string | null;
}): JSX.Element {
  const start = useStartStep(onDone);
  if (start.view === 'api-key') return <ApiKeyPath onDone={onDone} onBack={start.showChoices} />;
  if (start.view === 'plan') {
    return (
      <PlanView
        plans={start.plans}
        busy={start.busy}
        signingIn={start.signingIn}
        error={start.error}
        onChoose={start.choose}
        onSignedIn={start.onSignedIn}
        onBack={start.showChoices}
        onFree={() => {
          start.showChoices();
          start.choose(start.free.provider);
        }}
      />
    );
  }
  return (
    <ChooseView
      ready={start.ready}
      free={start.free}
      busy={start.busy}
      error={start.error}
      notice={notice}
      onChoose={start.choose}
      onPlans={start.showPlans}
      onApiKey={start.showApiKey}
      onSkip={onSkip}
    />
  );
}

/** Its own component so the key path's hook runs only while it shows. */
function ApiKeyPath({ onDone, onBack }: { readonly onDone: () => void; readonly onBack: () => void }): JSX.Element {
  return <ApiKeyView connect={useApiKeyConnect(onDone)} onBack={onBack} />;
}

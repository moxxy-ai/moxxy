/**
 * The first screen of a first run: one question, how to start. A plan already
 * signed in on this computer is offered first, lit, as one press into the chat.
 * Presentational: {@link useStartStep} decides what each answer means now.
 */

import { MoxxyMark } from '@/components/MoxxyMark';
import { Button } from '@moxxy/desktop-ui';
import { ChoiceRow } from '../../chrome';
import type { StartOption, StartProvider } from '../../start-options';

const FREE_LINE = 'A free model. No account needed.';

export function ChooseView({
  ready,
  free,
  busy,
  error,
  notice,
  onChoose,
  onPlans,
  onApiKey,
  onSkip,
}: {
  readonly ready: StartOption | null;
  readonly free: StartOption;
  readonly busy: StartProvider | null;
  readonly error: string | null;
  readonly notice?: string | null;
  readonly onChoose: (provider: StartProvider) => void;
  readonly onPlans: () => void;
  readonly onApiKey: () => void;
  readonly onSkip: () => void;
}): JSX.Element {
  const freeIdle = free.state === 'ready' || free.state === 'checking';
  return (
    <div className="onboard-start">
      <header className="onboard-start__head">
        <MoxxyMark size={56} />
        <h2 className="onboard-start__title">Hi, I&rsquo;m Moxxy.</h2>
        <p className="onboard-start__sub">How do you want to start? You can change this later.</p>
      </header>
      {notice && (
        <p role="status" className="onboard-start__notice">
          {notice}
        </p>
      )}
      <div className="onboard-choices">
        {ready && (
          <ChoiceRow
            lit
            title={`Continue with ${ready.name}`}
            detail={ready.detail}
            busy={busy === ready.provider}
            disabled={busy !== null}
            onPress={() => onChoose(ready.provider)}
          />
        )}
        <ChoiceRow
          title="Use my Claude or ChatGPT plan"
          detail="Sign in once. Moxxy uses your plan."
          disabled={busy !== null}
          onPress={onPlans}
        />
        <ChoiceRow
          title="Start free"
          detail={freeIdle ? FREE_LINE : free.detail}
          busy={busy === free.provider}
          disabled={busy !== null}
          progress={free.progress}
          onPress={() => onChoose(free.provider)}
        />
      </div>
      {error && (
        <p role="alert" className="onboard-error">
          {error}
        </p>
      )}
      <footer className="onboard-start__foot">
        <button type="button" className="onboard-link" onClick={onApiKey}>
          I have an API key
        </button>
        <Button variant="ghost" size="lg" onClick={onSkip}>
          Skip for now
        </Button>
      </footer>
    </div>
  );
}

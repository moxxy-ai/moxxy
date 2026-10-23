import { Icon } from '@moxxy/desktop-ui';
import type { BackgroundWorkBarView } from './useBackgroundWorkBar';

/** Above the message box while the agent runs work in the background: what runs, and the way into the Agents pane. */
export function BackgroundWorkBar({ bar }: { readonly bar: BackgroundWorkBarView }): JSX.Element {
  return (
    <button type="button" className="background-work-bar" data-testid="composer-background-work" onClick={bar.open} title="Show it in the Agents pane">
      <span className="background-work-bar__pulse" aria-hidden />
      <span className="background-work-bar__lead">In the background</span>
      <span className="background-work-bar__text">{bar.text}</span>
      <Icon name="chevron-right" size={12} />
    </button>
  );
}

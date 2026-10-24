import { Icon } from '@moxxy/desktop-ui';
import type { BackgroundWorkBarView } from './useBackgroundWorkBar';

/**
 * Above the message box: what the agent runs in the background, and when it
 * comes back by itself. Each line opens the Agents pane.
 */
export function BackgroundWorkBar({ bar }: { readonly bar: BackgroundWorkBarView }): JSX.Element {
  return (
    <div className="background-work" data-testid="composer-background-work">
      {bar.running && (
        <button type="button" className="background-work__line" onClick={bar.open} data-tip="Show it in the Agents pane">
          <span className="background-work__dot" aria-hidden />
          <span className="background-work__lead">In the background</span>
          <span className="background-work__text">{bar.running.text}</span>
          <Icon name="chevron-right" size={12} className="background-work__chevron" />
        </button>
      )}
      {bar.scheduled && (
        <button type="button" className="background-work__line" data-kind="scheduled" onClick={bar.open} data-tip="Show it in the Agents pane">
          <Icon name="clock" size={13} className="background-work__icon" />
          <span className="background-work__lead">{bar.scheduled.when}</span>
          <span className="background-work__text">{bar.scheduled.text}</span>
          {bar.scheduled.more > 0 && <span className="background-work__more">+{bar.scheduled.more}</span>}
          <Icon name="chevron-right" size={12} className="background-work__chevron" />
        </button>
      )}
    </div>
  );
}

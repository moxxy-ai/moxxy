import { Icon, type IconName } from '@moxxy/desktop-ui';
import { MarkdownBody } from '../MarkdownBody';
import { outcomeBody, type ModeOutcome, type OutcomeKind } from './mode-events';

const MARK: Record<OutcomeKind, IconName> = {
  plan: 'file',
  'goal-complete': 'check',
  'goal-paused': 'pause',
  'goal-ended': 'stop',
  'research-plan': 'search',
  'research-followup': 'search',
};

/** A way on from an outcome, offered under it. */
export interface OutcomeAction {
  readonly id: string;
  readonly label: string;
  readonly tone: 'primary' | 'neutral';
  readonly onClick: () => void;
}

/**
 * The message that closes a piece of a mode's work: a plan, the end of a goal
 * run, the questions of a research round. It is a document or a result, not a
 * line of talk, so it is a headed card instead of a bubble.
 */
export function ModeOutcomeCard({
  outcome,
  text,
  actions = [],
}: {
  readonly outcome: ModeOutcome;
  readonly text: string;
  /** Ways on from this outcome; none once the conversation has moved past it. */
  readonly actions?: ReadonlyArray<OutcomeAction>;
}): JSX.Element {
  return (
    <div className="outcome" data-testid="mode-outcome" data-kind={outcome.kind} data-tone={outcome.tone}>
      <div className="outcome__head">
        <span className="outcome__mark" aria-hidden>
          <Icon name={MARK[outcome.kind]} size={13} />
        </span>
        <span className="outcome__title">{outcome.title}</span>
        {outcome.facts.map((fact) => (
          <span key={fact.text} className="tag" data-tone={fact.tone}>
            {fact.text}
          </span>
        ))}
      </div>
      <div className="outcome__body">
        <MarkdownBody text={outcomeBody(outcome.kind, text)} streaming={false} />
      </div>
      {actions.length > 0 && (
        <div className="outcome__acts">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="ask-btn"
              data-tone={action.tone}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

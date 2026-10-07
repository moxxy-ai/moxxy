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

/**
 * The message that closes a piece of a mode's work: a plan, the end of a goal
 * run, the questions of a research round. It is a document or a result, not a
 * line of talk, so it is a headed card instead of a bubble.
 */
export function ModeOutcomeCard({
  outcome,
  text,
}: {
  readonly outcome: ModeOutcome;
  readonly text: string;
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
    </div>
  );
}

import { Icon } from '@moxxy/desktop-ui';
import type { QuestionAnswerDisplay } from '@moxxy/sdk/tool-display';

/**
 * A Question the person answered, as the transcript keeps it: each question
 * and what they chose, so the decision is still there after the card is gone.
 */
export function AnsweredQuestionBlock({ display }: { readonly display: QuestionAnswerDisplay }): JSX.Element {
  return (
    <div role="group" aria-label="You answered" className="answered" data-testid="block-question-answer">
      <div className="answered__head">
        <Icon name="chat" size={13} />
        <span>You answered</span>
      </div>
      <dl className="answered__list">
        {display.questions.map((item, at) => (
          <div key={at}>
            <dt className="answered__ask">
              {item.header && <span className="question__chip">{item.header}</span>}
              <span>{item.question}</span>
            </dt>
            <dd className="answered__said">
              {item.chosen.length > 0 && <span>{item.chosen.join(', ')}</span>}
              {item.chosen.length > 0 && item.own && ' '}
              {item.own && <span className="answered__own">{`“${item.own}”`}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

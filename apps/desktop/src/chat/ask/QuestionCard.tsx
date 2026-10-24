import { forwardRef, type RefObject } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { OpenQuestion, QuestionDraft, QuestionItem } from '@moxxy/sdk';
import { chordLabel } from '../../hotkeys/chordLabel';

/**
 * A Question from the agent, drawn: the suggested answers as buttons and, where
 * the question takes one, a field for an answer of the person's own. It only
 * draws the draft `useQuestion` holds and hands every pick back to it.
 *
 * A Question blocks no action and nothing answers it for the person, so there
 * is no safe answer and Escape gives none.
 */
export const QuestionCard = forwardRef<
  HTMLDivElement,
  {
    readonly question: OpenQuestion;
    readonly draft: QuestionDraft;
    readonly problem: string | null;
    readonly sending: boolean;
    readonly error: string | null;
    readonly onChoose: (item: QuestionItem, optionId: string) => void;
    readonly onType: (item: QuestionItem, text: string) => void;
    readonly onSubmit: () => void;
    readonly variant?: 'dock' | 'toast' | 'panel';
    /** A dialog takes the keyboard; a group sits beside whatever has it (the focus window). */
    readonly role?: 'dialog' | 'group';
    /** Handed to the first suggested answer when the card appears. */
    readonly focusRef?: RefObject<HTMLButtonElement>;
  }
>(function QuestionCard(
  { question, draft, problem, sending, error, onChoose, onType, onSubmit, variant = 'dock', role = 'dialog', focusRef },
  ref,
): JSX.Element {
  const blocked = problem !== null || sending;
  return (
    <div
      ref={ref}
      role={role}
      aria-modal={role === 'dialog' ? 'true' : undefined}
      aria-live={role === 'group' ? 'polite' : undefined}
      aria-label="Question from the agent"
      data-testid="question-dock"
      data-tone="accent"
      className={variant === 'dock' ? 'ask-dock' : `ask-dock ask-dock--${variant}`}
    >
      <div className="ask-dock__head">
        <span className="ask-dock__mark" aria-hidden>
          <Icon name="chat" size={13} />
        </span>
        <span className="ask-dock__title">Question</span>
      </div>
      <div className="question__list">
      {question.questions.map((item, index) => {
        const picked = draft[item.id];
        return (
          <fieldset key={item.id} className="question">
            <legend className="question__ask">
              {item.header && <span className="question__chip">{item.header}</span>}
              <span>{item.question}</span>
              {item.multiSelect && <span className="question__hint">Choose any</span>}
            </legend>
            {item.options.length > 0 && (
              <div className="question__choices">
                {item.options.map((option, at) => (
                  <button
                    key={option.id}
                    ref={index === 0 && at === 0 ? focusRef : undefined}
                    type="button"
                    className="question__choice"
                    aria-pressed={picked ? picked.selected.includes(option.id) : false}
                    onClick={() => onChoose(item, option.id)}
                  >
                    <span className="question__label">{option.label}</span>
                    {option.description && <span className="question__desc">{option.description}</span>}
                  </button>
                ))}
              </div>
            )}
            {item.allowOther && (
              <textarea
                aria-label={`Your own answer to: ${item.question}`}
                className="ask-dock__field"
                rows={2}
                placeholder={item.options.length > 0 ? 'Or write your own answer' : 'Write your answer'}
                value={picked ? picked.other : ''}
                onChange={(e) => onType(item, e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit();
                }}
              />
            )}
          </fieldset>
        );
      })}
      </div>
      {error && (
        <p role="alert" className="question__error">
          {error}
        </p>
      )}
      <div className="ask-dock__acts">
        <button
          type="button"
          className="ask-btn"
          data-tone="primary"
          title={problem ?? undefined}
          disabled={blocked}
          onClick={onSubmit}
        >
          {sending ? 'Sending…' : 'Send answer'}
        </button>
        {role === 'dialog' && <span className="ask-dock__keys">{chordLabel('mod+enter')} sends</span>}
      </div>
    </div>
  );
});

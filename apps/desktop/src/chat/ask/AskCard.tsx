import { forwardRef, type RefObject } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { MarkdownBody } from '../MarkdownBody';
import { ASK_FOCUS_TEXT, type AskPrompt } from './ask-prompt';

/**
 * A blocking question, drawn. The desktop docks it above the composer; the
 * focus window shows the same card in a smaller frame, beside the mark or in
 * the Mini Chat.
 *
 * What the agent wrote is read as prose. A tool's call is the exception: it
 * stays monospace and whole, in a well that scrolls, because it is the text
 * being vouched for.
 */
export const AskCard = forwardRef<
  HTMLDivElement,
  {
    readonly prompt: AskPrompt;
    readonly variant?: 'dock' | 'toast' | 'panel';
    /** A dialog takes the keyboard; a group sits beside whatever has it. */
    readonly role: 'dialog' | 'group';
    /** Handed to the control the question rests on when it appears. */
    readonly focusRef?: RefObject<HTMLElement>;
  }
>(function AskCard({ prompt, variant = 'dock', role, focusRef }, ref): JSX.Element {
  const rest = (id: string): RefObject<never> | undefined =>
    prompt.focus === id ? (focusRef as RefObject<never> | undefined) : undefined;
  const field = prompt.textInput;
  return (
    <div
      ref={ref}
      role={role}
      aria-modal={role === 'dialog' ? 'true' : undefined}
      aria-live={role === 'group' ? 'polite' : undefined}
      aria-label={prompt.label}
      data-testid="ask-dock"
      data-tone={prompt.kind}
      className={variant === 'dock' ? 'ask-dock' : `ask-dock ask-dock--${variant}`}
    >
      <div className="ask-dock__head">
        <span className="ask-dock__mark" aria-hidden>
          <Icon name={prompt.icon} size={13} />
        </span>
        <span className="ask-dock__title">{prompt.title}</span>
      </div>
      {prompt.lead && <p className="ask-dock__text">{prompt.lead}</p>}
      {prompt.prose && (
        <div className="ask-dock__body">
          <MarkdownBody text={prompt.prose} streaming={false} />
        </div>
      )}
      {prompt.command && <pre className="ask-dock__cmd">{prompt.command}</pre>}
      {field && (
        <textarea
          ref={rest(ASK_FOCUS_TEXT)}
          // Mounted mid-question (an answer that asks for words), so it takes
          // focus itself rather than waiting for the dialog to hand it over.
          autoFocus={role === 'dialog'}
          aria-label={field.label}
          value={field.value}
          placeholder={field.placeholder}
          rows={variant === 'toast' ? 2 : 3}
          className="ask-dock__field"
          onChange={(e) => field.onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && field.onSubmit) field.onSubmit();
          }}
        />
      )}
      <div className="ask-dock__acts">
        {prompt.actions.map((action) => (
          <button
            key={action.id}
            ref={rest(action.id)}
            type="button"
            className="ask-btn"
            data-tone={action.tone}
            title={action.title}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
        {prompt.keys && role === 'dialog' && <span className="ask-dock__keys">{prompt.keys}</span>}
      </div>
    </div>
  );
});

import { Icon } from '@moxxy/desktop-ui';
import { style } from './focus-styles';

export interface FocusPetBubbleContent {
  readonly kind: 'task' | 'reply';
  readonly title: string;
  readonly text: string;
  readonly busy: boolean;
}

/** Presentation-only status bubble shared by collapsed and active Focus chrome. */
export function FocusPetBubble({
  content,
  onActivate,
  onHide,
}: {
  readonly content: FocusPetBubbleContent;
  readonly onActivate: () => void;
  readonly onHide: () => void;
}): JSX.Element {
  const task = content.kind === 'task';
  return (
    <div
      className="focus-pet-bubble"
      style={style.focusPetBubbleFrame}
    >
      <span
        role="status"
        aria-label={task ? 'Current task' : 'Latest Moxxy reply'}
        aria-live="polite"
        style={style.visuallyHidden}
      >
        {content.title}: {content.text}
      </span>
      <button
        type="button"
        aria-label={task ? 'Open current task' : 'Open latest reply'}
        onClick={onActivate}
        style={{
          ...style.replyPreviewBubble,
          ...(task ? style.focusTaskBubble : style.focusReplyBubble),
        }}
      >
        <span style={task ? style.focusPetBubbleLine : undefined}>
          <strong style={style.focusPetBubbleTitle}>{content.title}</strong>
          <span aria-hidden style={style.focusPetBubbleSeparator}>•</span>
          <span style={task ? style.focusTaskBubbleText : undefined}>{content.text}</span>
        </span>
      </button>
      {content.busy && <span className="focus-task-spinner" aria-hidden style={style.focusTaskSpinner} />}
      <button
        type="button"
        className="focus-bubble-hide-button"
        aria-label={task ? 'Hide task status' : 'Dismiss latest reply'}
        title={task ? 'Hide task status' : 'Dismiss latest reply'}
        onClick={onHide}
        style={{
          ...style.focusBubbleHideButton,
          ...(task ? style.focusTaskHideButton : style.focusReplyHideButton),
        }}
      >
        {task
          ? <Icon name="chevron-right" size={15} style={{ transform: 'rotate(90deg)' }} />
          : <Icon name="x" size={14} />}
      </button>
    </div>
  );
}

export function FocusBubbleRestoreButton({
  onClick,
}: {
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="focus-bubble-restore-button"
      aria-label="Show task status"
      title="Show task status"
      onClick={onClick}
      style={style.focusBubbleRestoreButton}
    >
      <Icon name="chevron-right" size={14} style={{ transform: 'rotate(-90deg)' }} />
    </button>
  );
}

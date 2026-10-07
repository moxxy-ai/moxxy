import { Icon } from '@moxxy/desktop-ui';

export type SendAction = 'Send' | 'Queue' | 'Start goal';

/**
 * The composer's one filled control. It submits the form, and its name says
 * what a submit will do right now. While a turn runs it is the Stop button
 * instead, because that is the action in reach then.
 */
export function SendButton({
  running,
  action,
  disabled,
  onStop,
}: {
  readonly running: boolean;
  readonly action: SendAction;
  readonly disabled: boolean;
  readonly onStop: () => void;
}): JSX.Element {
  if (running) {
    return (
      <button
        type="button"
        className="composer-send tip"
        data-kind="stop"
        data-testid="composer-abort"
        data-tip="Stop"
        aria-label="Stop"
        onClick={onStop}
      >
        <Icon name="stop" size={14} />
      </button>
    );
  }
  return (
    <button
      type="submit"
      className="composer-send tip"
      data-kind="send"
      data-testid="composer-send"
      data-tip={action}
      aria-label={action}
      disabled={disabled}
    >
      <Icon name="send" size={15} />
    </button>
  );
}

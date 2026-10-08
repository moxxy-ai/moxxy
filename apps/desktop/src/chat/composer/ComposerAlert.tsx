import { Icon } from '@moxxy/desktop-ui';

/**
 * Why a file could not be attached. An alert, so it is read out, and it stays
 * until it is dismissed: a line that goes away by itself is one the person can
 * miss while looking at the file they just dropped.
 */
export function ComposerAlert({
  text,
  onDismiss,
}: {
  readonly text: string;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <div className="cmdbar__alert" role="alert">
      <span>{text}</span>
      <button type="button" className="cmdbar__alert-dismiss" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

/**
 * One answer of a first-run question: the whole row is the button. A name, one
 * plain line under it, and at the end a chevron, or a spinner while it works.
 * `lit` marks the way forward in the accent (a plan already signed in).
 * Presentational: the caller says what it is and what pressing it does.
 */

import { Icon } from '@moxxy/desktop-ui';

export function ChoiceRow({
  title,
  detail,
  onPress,
  busy = false,
  disabled = false,
  lit = false,
  progress = null,
}: {
  readonly title: string;
  readonly detail: string;
  readonly onPress: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly lit?: boolean;
  /** 0–1 while something installs and said how far; drawn as a thin bar. */
  readonly progress?: number | null;
}): JSX.Element {
  return (
    <button
      type="button"
      className="onboard-choice"
      data-lit={lit || undefined}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onPress}
    >
      <span className="onboard-choice__text">
        <span className="onboard-choice__title">{title}</span>
        <span className="onboard-choice__detail">{detail}</span>
      </span>
      <span className="onboard-choice__end" aria-hidden>
        {busy ? <span className="spinner" /> : <Icon name="chevron-right" size={16} />}
      </span>
      {busy && (
        <span className="onboard-choice__progress" data-indeterminate={progress === null || undefined} aria-hidden>
          <span
            className="onboard-choice__fill"
            style={progress !== null ? { transform: `scaleX(${progress})` } : undefined}
          />
        </span>
      )}
    </button>
  );
}
